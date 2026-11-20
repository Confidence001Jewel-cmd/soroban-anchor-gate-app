package anchor

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/soroban-anchor-gate/relay/internal/telemetry"
)

// SEP-38 Request for Quote (RFQ) client errors.
var (
	// ErrQuoteNotFound is returned when the anchor does not know the quote ID.
	ErrQuoteNotFound = errors.New("sep38: quote not found")
	// ErrQuoteExpired is returned when a quote's expiration timestamp has passed.
	ErrQuoteExpired = errors.New("sep38: quote has expired")
	// ErrQuoteExpiryBeforeEscrowDeadline is returned when a quote would expire
	// before the escrow lock deadline it is meant to guarantee a rate until.
	ErrQuoteExpiryBeforeEscrowDeadline = errors.New("sep38: quote expires before escrow lock deadline")
	// ErrQuoteIDMismatch is returned when a quote ID does not match the ID that
	// was reserved for an escrow.
	ErrQuoteIDMismatch = errors.New("sep38: quote ID mismatch")
	// ErrQuoteMissingID is returned when the anchor response omits the quote ID.
	ErrQuoteMissingID = errors.New("sep38: quote response is missing an id")
	// ErrQuoteMissingExpiry is returned when the anchor response omits expires_at.
	ErrQuoteMissingExpiry = errors.New("sep38: quote response is missing expires_at")
)

const (
	sep38DefaultTimeout = 15 * time.Second
	sepMaxResponseBytes = 1 << 20
)

// SEPError describes a non-2xx response returned by a SEP anchor.
type SEPError struct {
	StatusCode int
	Endpoint   string
	Message    string
}

// Error implements the error interface.
func (e *SEPError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("%s returned HTTP status %d", e.Endpoint, e.StatusCode)
	}
	return fmt.Sprintf("%s returned HTTP status %d: %s", e.Endpoint, e.StatusCode, e.Message)
}

var decimalPattern = regexp.MustCompile(`^\d+(\.\d+)?$`)

// validateDecimalAmount verifies a non-negative, strictly positive decimal string.
func validateDecimalAmount(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s cannot be empty", field)
	}
	if !decimalPattern.MatchString(value) {
		return fmt.Errorf("%s must be a decimal string, got %q", field, value)
	}
	if strings.Trim(value, "0.") == "" {
		return fmt.Errorf("%s must be greater than zero", field)
	}
	return nil
}

// parseSEPTimestamp parses an RFC3339 timestamp as used by SEP-24 and SEP-38.
// Empty values are treated as "not provided" and return the zero time.
func parseSEPTimestamp(field, value string) (time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return time.Time{}, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid %s timestamp %q: %w", field, value, err)
	}
	return parsed.UTC(), nil
}

// TokenProvider resolves a SEP-10 JWT used to authenticate anchor requests.
type TokenProvider func(ctx context.Context) (string, error)

// QuoteContext identifies how a SEP-38 quote is going to be used.
type QuoteContext string

// Supported SEP-38 quote contexts.
const (
	QuoteContextSEP6  QuoteContext = "sep6"
	QuoteContextSEP24 QuoteContext = "sep24"
	QuoteContextSEP31 QuoteContext = "sep31"
)

func (c QuoteContext) valid() bool {
	switch c {
	case "", QuoteContextSEP6, QuoteContextSEP24, QuoteContextSEP31:
		return true
	default:
		return false
	}
}

// PriceType identifies whether a price is indicative or firm.
type PriceType string

// Supported SEP-38 price types.
const (
	PriceTypeIndicative PriceType = "indicative"
	PriceTypeFirm       PriceType = "firm"
)

func (t PriceType) valid() bool {
	switch t {
	case "", PriceTypeIndicative, PriceTypeFirm:
		return true
	default:
		return false
	}
}

// PriceRequest describes a GET /prices query. Provide either SellAsset with
// SellAmount, or BuyAsset with BuyAmount. Every other field is optional.
type PriceRequest struct {
	Type               PriceType
	SellAsset          string
	SellAmount         string
	SellDeliveryMethod string
	BuyAsset           string
	BuyAmount          string
	BuyDeliveryMethod  string
	CountryCode        string
	Context            QuoteContext
}

// AssetPrice is a single entry of a SEP-38 /prices response.
type AssetPrice struct {
	Asset    string `json:"asset"`
	Price    string `json:"price"`
	Decimals int    `json:"decimals"`
}

// PricesResponse is the payload returned by GET /prices. Exactly one of the
// two lists is populated, depending on which side of the trade was requested.
type PricesResponse struct {
	BuyAssets  []AssetPrice `json:"buy_assets,omitempty"`
	SellAssets []AssetPrice `json:"sell_assets,omitempty"`
}

// FeeDetail is a single line item of a SEP-38 fee breakdown.
type FeeDetail struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Amount      string `json:"amount"`
}

// Fee is the fee breakdown returned with a SEP-38 quote.
type Fee struct {
	Total   string      `json:"total"`
	Asset   string      `json:"asset"`
	Details []FeeDetail `json:"details,omitempty"`
}

// Quote is a SEP-38 quote returned by POST /quote, GET /quote/{id}, or the
// firm quote reservation endpoint POST /quote/{id}.
type Quote struct {
	ID         string
	ExpiresAt  time.Time
	Price      string
	TotalPrice string
	SellAsset  string
	SellAmount string
	BuyAsset   string
	BuyAmount  string
	Fee        *Fee
}

type quotePayload struct {
	ID         string `json:"id"`
	ExpiresAt  string `json:"expires_at"`
	Price      string `json:"price"`
	TotalPrice string `json:"total_price"`
	SellAsset  string `json:"sell_asset"`
	SellAmount string `json:"sell_amount"`
	BuyAsset   string `json:"buy_asset"`
	BuyAmount  string `json:"buy_amount"`
	Fee        *Fee   `json:"fee,omitempty"`
}

// UnmarshalJSON parses a SEP-38 quote and converts expires_at to a time.Time.
func (q *Quote) UnmarshalJSON(data []byte) error {
	var payload quotePayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	expiresAt, err := parseSEPTimestamp("expires_at", payload.ExpiresAt)
	if err != nil {
		return err
	}
	*q = Quote{
		ID:         payload.ID,
		ExpiresAt:  expiresAt,
		Price:      payload.Price,
		TotalPrice: payload.TotalPrice,
		SellAsset:  payload.SellAsset,
		SellAmount: payload.SellAmount,
		BuyAsset:   payload.BuyAsset,
		BuyAmount:  payload.BuyAmount,
		Fee:        payload.Fee,
	}
	return nil
}

// QuoteRequest describes a POST /quote firm or indicative quote request.
// Exactly one of SellAmount or BuyAmount must be set.
type QuoteRequest struct {
	SellAsset          string
	BuyAsset           string
	SellAmount         string
	BuyAmount          string
	Context            QuoteContext
	CountryCode        string
	SellDeliveryMethod string
	BuyDeliveryMethod  string
	// ExpireAfter optionally requests that the anchor keeps the quote valid for
	// at least this many seconds.
	ExpireAfter int
}

func (r QuoteRequest) validate() error {
	if strings.TrimSpace(r.SellAsset) == "" {
		return errors.New("sell_asset cannot be empty")
	}
	if strings.TrimSpace(r.BuyAsset) == "" {
		return errors.New("buy_asset cannot be empty")
	}
	if r.SellAsset == r.BuyAsset {
		return errors.New("sell_asset and buy_asset must differ")
	}

	switch {
	case r.SellAmount == "" && r.BuyAmount == "":
		return errors.New("one of sell_amount or buy_amount must be provided")
	case r.SellAmount != "" && r.BuyAmount != "":
		return errors.New("sell_amount and buy_amount are mutually exclusive")
	case r.SellAmount != "":
		if err := validateDecimalAmount("sell_amount", r.SellAmount); err != nil {
			return err
		}
	default:
		if err := validateDecimalAmount("buy_amount", r.BuyAmount); err != nil {
			return err
		}
	}

	if !r.Context.valid() {
		return fmt.Errorf("unsupported quote context %q", r.Context)
	}
	if r.ExpireAfter < 0 {
		return errors.New("expire_after cannot be negative")
	}
	return nil
}

// SEP38Config configures a SEP-38 quote client.
type SEP38Config struct {
	// QuoteServer is the anchor's ANCHOR_QUOTE_SERVER base URL.
	QuoteServer string
	// AnchorDomain is the anchor hostname used for metric labels. Optional.
	AnchorDomain string
	// HTTPClient is the client used for anchor calls. Optional.
	HTTPClient *http.Client
	// TokenProvider optionally supplies a SEP-10 JWT for firm quotes.
	TokenProvider TokenProvider
	// Metrics optionally records anchor request metrics.
	Metrics *telemetry.Metrics
	// Clock optionally overrides time.Now, used for expiration validation.
	Clock func() time.Time
}

// SEP38Client implements the SEP-38 RFQ endpoints used to negotiate and lock
// exchange rates between off-chain fiat and on-chain Soroban tokens.
type SEP38Client struct {
	quoteServer   string
	anchorDomain  string
	httpClient    *http.Client
	tokenProvider TokenProvider
	metrics       *telemetry.Metrics
	now           func() time.Time
}

// NewSEP38Client builds a SEP-38 quote client.
func NewSEP38Client(cfg SEP38Config) (*SEP38Client, error) {
	server := strings.TrimSpace(cfg.QuoteServer)
	if server == "" {
		return nil, errors.New("sep38: quote server URL cannot be empty")
	}
	parsed, err := url.Parse(server)
	if err != nil {
		return nil, fmt.Errorf("sep38: invalid quote server URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("sep38: unsupported quote server scheme %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return nil, errors.New("sep38: quote server URL must include a host")
	}

	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: sep38DefaultTimeout}
	}
	now := cfg.Clock
	if now == nil {
		now = time.Now
	}
	domain := cfg.AnchorDomain
	if domain == "" {
		domain = parsed.Hostname()
	}

	return &SEP38Client{
		quoteServer:   strings.TrimRight(parsed.String(), "/"),
		anchorDomain:  domain,
		httpClient:    client,
		tokenProvider: cfg.TokenProvider,
		metrics:       cfg.Metrics,
		now:           now,
	}, nil
}

// AnchorDomain returns the anchor hostname attached to this client.
func (c *SEP38Client) AnchorDomain() string { return c.anchorDomain }

// GetPrices fetches indicative or firm prices from GET /prices.
func (c *SEP38Client) GetPrices(ctx context.Context, req PriceRequest) (*PricesResponse, error) {
	if !req.Type.valid() {
		return nil, fmt.Errorf("unsupported price type %q", req.Type)
	}
	if !req.Context.valid() {
		return nil, fmt.Errorf("unsupported quote context %q", req.Context)
	}
	if req.SellAsset == "" && req.BuyAsset == "" {
		return nil, errors.New("one of sell_asset or buy_asset must be provided")
	}
	if req.SellAmount != "" {
		if req.SellAsset == "" {
			return nil, errors.New("sell_asset is required when sell_amount is provided")
		}
		if err := validateDecimalAmount("sell_amount", req.SellAmount); err != nil {
			return nil, err
		}
	}
	if req.BuyAmount != "" {
		if req.BuyAsset == "" {
			return nil, errors.New("buy_asset is required when buy_amount is provided")
		}
		if err := validateDecimalAmount("buy_amount", req.BuyAmount); err != nil {
			return nil, err
		}
	}

	query := url.Values{}
	setIfNotEmpty(query, "type", string(req.Type))
	setIfNotEmpty(query, "sell_asset", req.SellAsset)
	setIfNotEmpty(query, "sell_amount", req.SellAmount)
	setIfNotEmpty(query, "sell_delivery_method", req.SellDeliveryMethod)
	setIfNotEmpty(query, "buy_asset", req.BuyAsset)
	setIfNotEmpty(query, "buy_amount", req.BuyAmount)
	setIfNotEmpty(query, "buy_delivery_method", req.BuyDeliveryMethod)
	setIfNotEmpty(query, "country_code", req.CountryCode)
	setIfNotEmpty(query, "context", string(req.Context))

	var resp PricesResponse
	if err := c.doJSON(ctx, http.MethodGet, "/prices", query, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// CreateQuote requests a quote from POST /quote.
func (c *SEP38Client) CreateQuote(ctx context.Context, req QuoteRequest) (*Quote, error) {
	if err := req.validate(); err != nil {
		return nil, err
	}

	payload := map[string]interface{}{
		"sell_asset": req.SellAsset,
		"buy_asset":  req.BuyAsset,
	}
	if req.SellAmount != "" {
		payload["sell_amount"] = req.SellAmount
	} else {
		payload["buy_amount"] = req.BuyAmount
	}
	if req.Context != "" {
		payload["context"] = string(req.Context)
	}
	if req.CountryCode != "" {
		payload["country_code"] = req.CountryCode
	}
	if req.SellDeliveryMethod != "" {
		payload["sell_delivery_method"] = req.SellDeliveryMethod
	}
	if req.BuyDeliveryMethod != "" {
		payload["buy_delivery_method"] = req.BuyDeliveryMethod
	}
	if req.ExpireAfter > 0 {
		payload["expire_after"] = req.ExpireAfter
	}

	quote, err := c.fetchQuote(ctx, http.MethodPost, "/quote", payload)
	if err != nil {
		return nil, err
	}
	return quote, nil
}

// GetQuote fetches an existing quote from GET /quote/{id}.
func (c *SEP38Client) GetQuote(ctx context.Context, id string) (*Quote, error) {
	if err := validateQuoteID(id); err != nil {
		return nil, err
	}
	return c.fetchQuote(ctx, http.MethodGet, "/quote/"+url.PathEscape(id), nil)
}

// ReserveFirmQuote converts an existing quote into a firm commitment via
// POST /quote/{id}. Firm quotes require SEP-10 authentication.
func (c *SEP38Client) ReserveFirmQuote(ctx context.Context, id string) (*Quote, error) {
	if err := validateQuoteID(id); err != nil {
		return nil, err
	}
	quote, err := c.fetchQuote(ctx, http.MethodPost, "/quote/"+url.PathEscape(id), nil)
	if err != nil {
		return nil, err
	}
	return quote, nil
}

// PollQuote repeatedly fetches a quote until the anchor has persisted it,
// returning ErrQuoteExpired if the anchor reports an expired quote. The call
// returns immediately on the first non-404 response.
func (c *SEP38Client) PollQuote(ctx context.Context, id string, interval time.Duration) (*Quote, error) {
	if err := validateQuoteID(id); err != nil {
		return nil, err
	}
	if interval <= 0 {
		interval = time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		quote, err := c.GetQuote(ctx, id)
		if err == nil {
			if !c.now().Before(quote.ExpiresAt) {
				return quote, ErrQuoteExpired
			}
			return quote, nil
		}
		if !errors.Is(err, ErrQuoteNotFound) {
			return nil, err
		}

		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("sep38: quote %s not available before deadline: %w", id, ctx.Err())
		case <-ticker.C:
		}
	}
}

// ValidateQuoteForEscrow verifies that a quote is still usable for an escrow
// whose funds are locked until escrowLockDeadline. A zero deadline only checks
// that the quote has not expired.
func (c *SEP38Client) ValidateQuoteForEscrow(quote *Quote, escrowLockDeadline time.Time) error {
	if quote == nil {
		return errors.New("sep38: quote is required")
	}
	if strings.TrimSpace(quote.ID) == "" {
		return ErrQuoteMissingID
	}
	if quote.ExpiresAt.IsZero() {
		return ErrQuoteMissingExpiry
	}

	now := c.now()
	if !now.Before(quote.ExpiresAt) {
		return fmt.Errorf("%w: expired at %s", ErrQuoteExpired, quote.ExpiresAt.Format(time.RFC3339))
	}
	if !escrowLockDeadline.IsZero() && !quote.ExpiresAt.After(escrowLockDeadline) {
		return fmt.Errorf("%w: quote expires %s, deadline %s",
			ErrQuoteExpiryBeforeEscrowDeadline,
			quote.ExpiresAt.Format(time.RFC3339),
			escrowLockDeadline.Format(time.RFC3339),
		)
	}
	return nil
}

// VerifyQuoteID checks that the quote ID returned by the anchor matches the ID
// that was reserved for an escrow before authorizing an on-chain release. The
// comparison is constant time to avoid leaking quote identifiers.
func VerifyQuoteID(reserved, returned string) error {
	reserved = strings.TrimSpace(reserved)
	returned = strings.TrimSpace(returned)
	if reserved == "" {
		return fmt.Errorf("%w: reserved quote ID cannot be empty", ErrQuoteIDMismatch)
	}
	if returned == "" {
		return ErrQuoteMissingID
	}
	if subtle.ConstantTimeCompare([]byte(reserved), []byte(returned)) != 1 || len(reserved) != len(returned) {
		return fmt.Errorf("%w: reserved %q, anchor returned %q", ErrQuoteIDMismatch, reserved, returned)
	}
	return nil
}

// AuthorizeEscrowRelease re-fetches a reserved quote, verifies quote ID
// integrity and validates its expiration against the escrow lock deadline
// before an on-chain release is authorized.
func (c *SEP38Client) AuthorizeEscrowRelease(ctx context.Context, reservedQuoteID string, escrowLockDeadline time.Time) (*Quote, error) {
	if strings.TrimSpace(reservedQuoteID) == "" {
		return nil, fmt.Errorf("%w: reserved quote ID cannot be empty", ErrQuoteIDMismatch)
	}

	quote, err := c.GetQuote(ctx, reservedQuoteID)
	if err != nil {
		return nil, err
	}
	if err := VerifyQuoteID(reservedQuoteID, quote.ID); err != nil {
		return nil, err
	}
	if err := c.ValidateQuoteForEscrow(quote, escrowLockDeadline); err != nil {
		return nil, err
	}
	return quote, nil
}

func validateQuoteID(id string) error {
	if strings.TrimSpace(id) == "" {
		return errors.New("sep38: quote ID cannot be empty")
	}
	return nil
}

func (c *SEP38Client) fetchQuote(ctx context.Context, method, path string, payload interface{}) (*Quote, error) {
	var quote Quote
	if err := c.doJSON(ctx, method, path, nil, payload, &quote); err != nil {
		return nil, err
	}
	if strings.TrimSpace(quote.ID) == "" {
		return nil, ErrQuoteMissingID
	}
	if quote.ExpiresAt.IsZero() {
		return nil, ErrQuoteMissingExpiry
	}
	return &quote, nil
}

func (c *SEP38Client) doJSON(ctx context.Context, method, path string, query url.Values, payload, out interface{}) error {
	endpoint := c.quoteServer + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}

	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("sep38: failed to encode request body: %w", err)
		}
		body = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return fmt.Errorf("sep38: failed to build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.tokenProvider != nil {
		token, err := c.tokenProvider(ctx)
		if err != nil {
			return fmt.Errorf("sep38: failed to obtain SEP-10 token: %w", err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
	}
	telemetry.InjectTraceContext(ctx, req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.recordRequest(path, "error")
		return fmt.Errorf("sep38: %s %s failed: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, sepMaxResponseBytes))
	if err != nil {
		c.recordRequest(path, "error")
		return fmt.Errorf("sep38: failed to read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.recordRequest(path, "error")
		message := decodeAnchorError(bodyBytes)
		if resp.StatusCode == http.StatusNotFound {
			return fmt.Errorf("%w: %s", ErrQuoteNotFound, message)
		}
		return &SEPError{StatusCode: resp.StatusCode, Endpoint: path, Message: message}
	}

	if out != nil {
		if err := json.Unmarshal(bodyBytes, out); err != nil {
			c.recordRequest(path, "error")
			return fmt.Errorf("sep38: failed to parse response JSON: %w", err)
		}
	}
	c.recordRequest(path, "success")
	return nil
}

func (c *SEP38Client) recordRequest(path, status string) {
	if c == nil || c.metrics == nil {
		return
	}
	operation := strings.TrimPrefix(path, "/")
	if operation == "" {
		operation = "unknown"
	}
	c.metrics.RecordAnchorRequest(c.anchorDomain, "sep38_"+operation, status)
}

func setIfNotEmpty(query url.Values, key, value string) {
	if strings.TrimSpace(value) != "" {
		query.Set(key, value)
	}
}

// decodeAnchorError extracts the human readable "error" field of an anchor
// error response, falling back to the raw body.
func decodeAnchorError(body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return ""
	}
	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err == nil && strings.TrimSpace(payload.Error) != "" {
		return payload.Error
	}
	if len(trimmed) > 256 {
		return trimmed[:256]
	}
	return trimmed
}
