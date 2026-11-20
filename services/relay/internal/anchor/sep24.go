package anchor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/soroban-anchor-gate/relay/internal/telemetry"
)

// EscrowStatus is the relay's internal lifecycle state for an escrow.
type EscrowStatus string

// Internal escrow lifecycle states driven by anchor transaction transitions.
const (
	EscrowStatusPending    EscrowStatus = "pending"
	EscrowStatusAwaiting   EscrowStatus = "awaiting_user"
	EscrowStatusProcessing EscrowStatus = "processing"
	EscrowStatusCompleted  EscrowStatus = "completed"
	EscrowStatusRefunded   EscrowStatus = "refunded"
	EscrowStatusExpired    EscrowStatus = "expired"
	EscrowStatusFailed     EscrowStatus = "failed"
)

// EscrowRecord is the internal record whose status is updated as the anchor
// transitions a SEP-24 transaction.
type EscrowRecord struct {
	EscrowID            uint64       `json:"escrow_id"`
	Status              EscrowStatus `json:"status"`
	AnchorTransactionID string       `json:"anchor_transaction_id,omitempty"`
	InteractiveURL      string       `json:"interactive_url,omitempty"`
	Kind                string       `json:"kind,omitempty"`
	Message             string       `json:"message,omitempty"`
	UpdatedAt           time.Time    `json:"updated_at"`
}

// EscrowStore persists escrow records. Implementations must be safe for
// concurrent use.
type EscrowStore interface {
	GetEscrow(escrowID uint64) (EscrowRecord, bool)
	GetEscrowByAnchorTransaction(transactionID string) (EscrowRecord, bool)
	SaveEscrow(record EscrowRecord) error
}

// MemoryEscrowStore is an in-memory EscrowStore suitable for the relay's
// single-process usage and for tests.
type MemoryEscrowStore struct {
	mu            sync.RWMutex
	records       map[uint64]EscrowRecord
	byTransaction map[string]uint64
}

// NewMemoryEscrowStore creates an empty in-memory escrow store.
func NewMemoryEscrowStore() *MemoryEscrowStore {
	return &MemoryEscrowStore{
		records:       make(map[uint64]EscrowRecord),
		byTransaction: make(map[string]uint64),
	}
}

// GetEscrow returns the escrow record for the given on-chain escrow ID.
func (s *MemoryEscrowStore) GetEscrow(escrowID uint64) (EscrowRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.records[escrowID]
	return record, ok
}

// GetEscrowByAnchorTransaction returns the escrow record for an anchor
// transaction ID, which is how webhook callbacks are routed back to an escrow.
func (s *MemoryEscrowStore) GetEscrowByAnchorTransaction(transactionID string) (EscrowRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	escrowID, ok := s.byTransaction[transactionID]
	if !ok {
		return EscrowRecord{}, false
	}
	record, ok := s.records[escrowID]
	return record, ok
}

// SaveEscrow upserts an escrow record.
func (s *MemoryEscrowStore) SaveEscrow(record EscrowRecord) error {
	if record.EscrowID == 0 {
		return errors.New("escrow record requires a non-zero escrow ID")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.records[record.EscrowID]; ok && existing.AnchorTransactionID != "" {
		delete(s.byTransaction, existing.AnchorTransactionID)
	}
	s.records[record.EscrowID] = record
	if record.AnchorTransactionID != "" {
		s.byTransaction[record.AnchorTransactionID] = record.EscrowID
	}
	return nil
}

// SEP-24 interactive transaction statuses.
const (
	SEP24StatusIncomplete             = "incomplete"
	SEP24StatusPendingUserTransfer    = "pending_user_transfer_start"
	SEP24StatusPendingUserTransferEnd = "pending_user_transfer_complete"
	SEP24StatusPendingExternal        = "pending_external"
	SEP24StatusPendingAnchor          = "pending_anchor"
	SEP24StatusPendingStellar         = "pending_stellar"
	SEP24StatusPendingTrust           = "pending_trust"
	SEP24StatusPendingUser            = "pending_user"
	SEP24StatusPendingCustomerInfo    = "pending_customer_info_update"
	SEP24StatusCompleted              = "completed"
	SEP24StatusRefunded               = "refunded"
	SEP24StatusExpired                = "expired"
	SEP24StatusNoMarket               = "no_market"
	SEP24StatusTooSmall               = "too_small"
	SEP24StatusTooLarge               = "too_large"
	SEP24StatusError                  = "error"
)

// InteractiveTransactionRequest is the body of a SEP-24
// /transactions/deposit/interactive or /transactions/withdraw/interactive call.
type InteractiveTransactionRequest struct {
	AssetCode                 string `json:"asset_code"`
	AssetIssuer               string `json:"asset_issuer,omitempty"`
	Amount                    string `json:"amount,omitempty"`
	Account                   string `json:"account,omitempty"`
	EmailAddress              string `json:"email_address,omitempty"`
	Memo                      string `json:"memo,omitempty"`
	MemoType                  string `json:"memo_type,omitempty"`
	WalletName                string `json:"wallet_name,omitempty"`
	WalletURL                 string `json:"wallet_url,omitempty"`
	Lang                      string `json:"lang,omitempty"`
	OnChangeCallback          string `json:"on_change_callback,omitempty"`
	ClaimableBalanceSupported bool   `json:"claimable_balance_supported,omitempty"`
}

// Validate checks the request against the SEP-24 requirements.
func (r InteractiveTransactionRequest) Validate() error {
	if strings.TrimSpace(r.AssetCode) == "" {
		return errors.New("asset_code cannot be empty")
	}
	if strings.Contains(r.AssetCode, ":") {
		return errors.New("asset_code must be the code only; use asset_issuer for the issuer")
	}
	if r.Amount != "" {
		if err := validateDecimalAmount("amount", r.Amount); err != nil {
			return err
		}
	}
	switch r.MemoType {
	case "", "text", "id", "hash":
	default:
		return fmt.Errorf("unsupported memo_type %q", r.MemoType)
	}
	if r.MemoType != "" && r.Memo == "" {
		return errors.New("memo_type requires a memo")
	}
	return nil
}

// InteractiveTransactionResponse is the anchor's interactive flow response,
// containing the hosted URL the user must be sent to.
type InteractiveTransactionResponse struct {
	Type  string `json:"type"`
	URL   string `json:"url"`
	ID    string `json:"id"`
	Error string `json:"error,omitempty"`
}

// SEP24Transaction is a transaction returned by GET /transaction.
type SEP24Transaction struct {
	ID                    string
	Kind                  string
	Status                string
	AmountIn              string
	AmountOut             string
	AmountFee             string
	StartedAt             time.Time
	UpdatedAt             time.Time
	CompletedAt           time.Time
	UserActionRequiredBy  time.Time
	Message               string
	ExternalTransactionID string
	StellarTransactionID  string
	MoreInfoURL           string
	WithdrawAnchorAccount string
	WithdrawMemo          string
	WithdrawMemoType      string
	From                  string
	To                    string
}

type transactionPayload struct {
	ID                    string `json:"id"`
	Kind                  string `json:"kind"`
	Status                string `json:"status"`
	AmountIn              string `json:"amount_in"`
	AmountOut             string `json:"amount_out"`
	AmountFee             string `json:"amount_fee"`
	StartedAt             string `json:"started_at"`
	UpdatedAt             string `json:"updated_at"`
	CompletedAt           string `json:"completed_at"`
	UserActionRequiredBy  string `json:"user_action_required_by"`
	Message               string `json:"message"`
	ExternalTransactionID string `json:"external_transaction_id"`
	StellarTransactionID  string `json:"stellar_transaction_id"`
	MoreInfoURL           string `json:"more_info_url"`
	WithdrawAnchorAccount string `json:"withdraw_anchor_account"`
	WithdrawMemo          string `json:"withdraw_memo"`
	WithdrawMemoType      string `json:"withdraw_memo_type"`
	From                  string `json:"from"`
	To                    string `json:"to"`
}

// UnmarshalJSON parses a SEP-24 transaction and converts RFC3339 timestamps.
func (t *SEP24Transaction) UnmarshalJSON(data []byte) error {
	var payload transactionPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}

	startedAt, err := parseSEPTimestamp("started_at", payload.StartedAt)
	if err != nil {
		return err
	}
	updatedAt, err := parseSEPTimestamp("updated_at", payload.UpdatedAt)
	if err != nil {
		return err
	}
	completedAt, err := parseSEPTimestamp("completed_at", payload.CompletedAt)
	if err != nil {
		return err
	}
	actionRequired, err := parseSEPTimestamp("user_action_required_by", payload.UserActionRequiredBy)
	if err != nil {
		return err
	}

	*t = SEP24Transaction{
		ID:                    payload.ID,
		Kind:                  payload.Kind,
		Status:                payload.Status,
		AmountIn:              payload.AmountIn,
		AmountOut:             payload.AmountOut,
		AmountFee:             payload.AmountFee,
		StartedAt:             startedAt,
		UpdatedAt:             updatedAt,
		CompletedAt:           completedAt,
		UserActionRequiredBy:  actionRequired,
		Message:               payload.Message,
		ExternalTransactionID: payload.ExternalTransactionID,
		StellarTransactionID:  payload.StellarTransactionID,
		MoreInfoURL:           payload.MoreInfoURL,
		WithdrawAnchorAccount: payload.WithdrawAnchorAccount,
		WithdrawMemo:          payload.WithdrawMemo,
		WithdrawMemoType:      payload.WithdrawMemoType,
		From:                  payload.From,
		To:                    payload.To,
	}
	return nil
}

// Terminal reports whether no further status transition is expected.
func (t SEP24Transaction) Terminal() bool {
	switch t.Status {
	case SEP24StatusCompleted, SEP24StatusRefunded, SEP24StatusExpired,
		SEP24StatusError, SEP24StatusNoMarket, SEP24StatusTooSmall, SEP24StatusTooLarge:
		return true
	default:
		return false
	}
}

// MapSEP24Status converts a SEP-24 status into an internal escrow status.
func MapSEP24Status(status string) (EscrowStatus, error) {
	switch status {
	case SEP24StatusIncomplete, SEP24StatusPendingCustomerInfo, SEP24StatusPendingUserTransfer,
		SEP24StatusPendingUserTransferEnd, SEP24StatusPendingTrust, SEP24StatusPendingUser:
		return EscrowStatusAwaiting, nil
	case SEP24StatusPendingExternal, SEP24StatusPendingAnchor, SEP24StatusPendingStellar:
		return EscrowStatusProcessing, nil
	case SEP24StatusCompleted:
		return EscrowStatusCompleted, nil
	case SEP24StatusRefunded:
		return EscrowStatusRefunded, nil
	case SEP24StatusExpired:
		return EscrowStatusExpired, nil
	case SEP24StatusError, SEP24StatusNoMarket, SEP24StatusTooSmall, SEP24StatusTooLarge:
		return EscrowStatusFailed, nil
	default:
		return "", fmt.Errorf("unsupported SEP-24 transaction status %q", status)
	}
}

// SEP24Config configures a SEP-24 interactive flow client.
type SEP24Config struct {
	// TransferServer is the anchor's TRANSFER_SERVER_SEP0024 base URL.
	TransferServer string
	// AnchorDomain is the anchor hostname used for metric labels. Optional.
	AnchorDomain string
	// HTTPClient is the client used for anchor calls. Optional.
	HTTPClient *http.Client
	// TokenProvider optionally supplies a SEP-10 JWT for authenticated calls.
	TokenProvider TokenProvider
	// EscrowStore receives escrow status transitions. Optional.
	EscrowStore EscrowStore
	// Metrics optionally records anchor request metrics.
	Metrics *telemetry.Metrics
	// PollInterval is the delay between transaction polls. Defaults to 5s.
	PollInterval time.Duration
	// PollTimeout bounds a single PollTransaction call. Defaults to 2m.
	PollTimeout time.Duration
	// Clock optionally overrides time.Now.
	Clock func() time.Time
}

// SEP24Client orchestrates SEP-24 hosted interactive deposit and withdrawal
// flows and keeps internal escrow records in sync with anchor transactions.
type SEP24Client struct {
	transferServer string
	anchorDomain   string
	httpClient     *http.Client
	tokenProvider  TokenProvider
	escrows        EscrowStore
	metrics        *telemetry.Metrics
	pollInterval   time.Duration
	pollTimeout    time.Duration
	now            func() time.Time
}

// NewSEP24Client builds a SEP-24 interactive flow client.
func NewSEP24Client(cfg SEP24Config) (*SEP24Client, error) {
	server := strings.TrimSpace(cfg.TransferServer)
	if server == "" {
		return nil, errors.New("sep24: transfer server URL cannot be empty")
	}
	parsed, err := url.Parse(server)
	if err != nil {
		return nil, fmt.Errorf("sep24: invalid transfer server URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("sep24: unsupported transfer server scheme %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return nil, errors.New("sep24: transfer server URL must include a host")
	}

	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Second}
	}
	pollInterval := cfg.PollInterval
	if pollInterval <= 0 {
		pollInterval = 5 * time.Second
	}
	pollTimeout := cfg.PollTimeout
	if pollTimeout <= 0 {
		pollTimeout = 2 * time.Minute
	}
	now := cfg.Clock
	if now == nil {
		now = time.Now
	}
	domain := cfg.AnchorDomain
	if domain == "" {
		domain = parsed.Hostname()
	}

	return &SEP24Client{
		transferServer: strings.TrimRight(parsed.String(), "/"),
		anchorDomain:   domain,
		httpClient:     httpClient,
		tokenProvider:  cfg.TokenProvider,
		escrows:        cfg.EscrowStore,
		metrics:        cfg.Metrics,
		pollInterval:   pollInterval,
		pollTimeout:    pollTimeout,
		now:            now,
	}, nil
}

// AnchorDomain returns the anchor hostname attached to this client.
func (c *SEP24Client) AnchorDomain() string { return c.anchorDomain }

// DepositInteractive starts the hosted deposit flow for an escrow and records
// the interactive URL against the internal escrow record.
func (c *SEP24Client) DepositInteractive(ctx context.Context, escrowID uint64, req InteractiveTransactionRequest) (*InteractiveTransactionResponse, error) {
	return c.interactive(ctx, "deposit", escrowID, req)
}

// WithdrawInteractive starts the hosted withdrawal flow for an escrow and
// records the interactive URL against the internal escrow record.
func (c *SEP24Client) WithdrawInteractive(ctx context.Context, escrowID uint64, req InteractiveTransactionRequest) (*InteractiveTransactionResponse, error) {
	return c.interactive(ctx, "withdraw", escrowID, req)
}

func (c *SEP24Client) interactive(ctx context.Context, kind string, escrowID uint64, req InteractiveTransactionRequest) (*InteractiveTransactionResponse, error) {
	if escrowID == 0 {
		return nil, errors.New("sep24: escrow ID must be non-zero")
	}
	if err := req.Validate(); err != nil {
		return nil, err
	}

	path := "/transactions/" + kind + "/interactive"
	var resp InteractiveTransactionResponse
	if err := c.doJSON(ctx, http.MethodPost, path, nil, req, &resp); err != nil {
		return nil, err
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("sep24: anchor rejected %s request: %s", kind, resp.Error)
	}
	if resp.Type != "interactive_customer_info_needed" {
		return nil, fmt.Errorf("sep24: unexpected interactive response type %q", resp.Type)
	}
	if strings.TrimSpace(resp.ID) == "" {
		return nil, errors.New("sep24: interactive response is missing an id")
	}
	if _, err := ParseInteractiveURL(resp.URL); err != nil {
		return nil, err
	}

	if c.escrows != nil {
		record := EscrowRecord{
			EscrowID:            escrowID,
			Status:              EscrowStatusAwaiting,
			AnchorTransactionID: resp.ID,
			InteractiveURL:      resp.URL,
			Kind:                kind,
			UpdatedAt:           c.now().UTC(),
		}
		if err := c.escrows.SaveEscrow(record); err != nil {
			return nil, fmt.Errorf("sep24: failed to persist escrow record: %w", err)
		}
	}

	return &resp, nil
}

// GetTransaction fetches a single SEP-24 transaction from GET /transaction.
func (c *SEP24Client) GetTransaction(ctx context.Context, transactionID string) (*SEP24Transaction, error) {
	if strings.TrimSpace(transactionID) == "" {
		return nil, errors.New("sep24: transaction ID cannot be empty")
	}

	query := url.Values{}
	query.Set("id", transactionID)

	var payload struct {
		Transaction *SEP24Transaction `json:"transaction"`
		Error       string            `json:"error,omitempty"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/transaction", query, nil, &payload); err != nil {
		return nil, err
	}
	if payload.Error != "" {
		return nil, fmt.Errorf("sep24: anchor returned error: %s", payload.Error)
	}
	if payload.Transaction == nil {
		return nil, errors.New("sep24: anchor response did not include a transaction")
	}
	if payload.Transaction.ID == "" {
		payload.Transaction.ID = transactionID
	}
	return payload.Transaction, nil
}

// PollTransaction polls GET /transaction until the transaction reaches a
// terminal status or the client's poll timeout elapses.
func (c *SEP24Client) PollTransaction(ctx context.Context, transactionID string) (*SEP24Transaction, error) {
	pollCtx, cancel := context.WithTimeout(ctx, c.pollTimeout)
	defer cancel()

	ticker := time.NewTicker(c.pollInterval)
	defer ticker.Stop()

	var lastErr error
	for {
		tx, err := c.GetTransaction(pollCtx, transactionID)
		if err != nil {
			lastErr = err
		} else if tx.Terminal() {
			return tx, nil
		} else {
			lastErr = nil
		}

		select {
		case <-pollCtx.Done():
			if lastErr != nil {
				return nil, fmt.Errorf("sep24: polling transaction %s failed: %w", transactionID, lastErr)
			}
			return nil, fmt.Errorf("sep24: transaction %s did not reach a terminal status before timeout: %w", transactionID, pollCtx.Err())
		case <-ticker.C:
		}
	}
}

// RefreshEscrowStatus fetches the anchor transaction for an escrow and persists
// the mapped internal escrow status.
func (c *SEP24Client) RefreshEscrowStatus(ctx context.Context, escrowID uint64) (EscrowRecord, error) {
	record, err := c.requireEscrow(escrowID)
	if err != nil {
		return EscrowRecord{}, err
	}
	if strings.TrimSpace(record.AnchorTransactionID) == "" {
		return EscrowRecord{}, fmt.Errorf("sep24: escrow %d has no anchor transaction ID", escrowID)
	}

	tx, err := c.GetTransaction(ctx, record.AnchorTransactionID)
	if err != nil {
		return EscrowRecord{}, err
	}
	return c.UpdateEscrowFromTransaction(ctx, escrowID, tx)
}

// UpdateEscrowFromTransaction maps an anchor transaction status onto the
// internal escrow record and persists it.
func (c *SEP24Client) UpdateEscrowFromTransaction(ctx context.Context, escrowID uint64, tx *SEP24Transaction) (EscrowRecord, error) {
	if tx == nil {
		return EscrowRecord{}, errors.New("sep24: transaction is required")
	}

	status, err := MapSEP24Status(tx.Status)
	if err != nil {
		return EscrowRecord{}, err
	}

	record, err := c.requireEscrow(escrowID)
	if err != nil {
		return EscrowRecord{}, err
	}

	record.EscrowID = escrowID
	record.Status = status
	record.Message = tx.Message
	record.UpdatedAt = c.now().UTC()
	if tx.ID != "" {
		record.AnchorTransactionID = tx.ID
	}
	if tx.Kind != "" {
		record.Kind = tx.Kind
	}

	if err := c.escrows.SaveEscrow(record); err != nil {
		return EscrowRecord{}, fmt.Errorf("sep24: failed to persist escrow record: %w", err)
	}

	if status == EscrowStatusCompleted && !tx.StartedAt.IsZero() && c.metrics != nil {
		completedAt := tx.CompletedAt
		if completedAt.IsZero() {
			completedAt = c.now()
		}
		if latency := completedAt.Sub(tx.StartedAt); latency > 0 {
			c.metrics.ObserveAnchorPayout(c.anchorDomain, latency)
		}
	}

	return record, nil
}

func (c *SEP24Client) requireEscrow(escrowID uint64) (EscrowRecord, error) {
	if c.escrows == nil {
		return EscrowRecord{}, errors.New("sep24: escrow store is not configured")
	}
	record, ok := c.escrows.GetEscrow(escrowID)
	if !ok {
		return EscrowRecord{}, fmt.Errorf("sep24: escrow %d not found", escrowID)
	}
	return record, nil
}

// WebhookCallback holds the parameters parsed from a SEP-24 webhook callback.
type WebhookCallback struct {
	TransactionID string
	Status        string
	Kind          string
	Transaction   *SEP24Transaction
	Query         url.Values
	Method        string
}

// ParseWebhookCallback parses the transaction parameters an anchor sends to a
// SEP-24 `on_change_callback` endpoint. Query parameters, form posts and JSON
// bodies (either flat or wrapped in a `transaction` object) are supported.
func ParseWebhookCallback(r *http.Request) (*WebhookCallback, error) {
	if r == nil {
		return nil, errors.New("sep24: request is required")
	}

	callback := &WebhookCallback{Query: url.Values{}, Method: r.Method}

	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		callback.Query = r.URL.Query()
		callback.TransactionID = firstNonEmpty(callback.Query.Get("transaction_id"), callback.Query.Get("id"))
		callback.Status = callback.Query.Get("status")
		callback.Kind = firstNonEmpty(callback.Query.Get("kind"), callback.Query.Get("type"))
	} else {
		contentType := strings.ToLower(r.Header.Get("Content-Type"))
		if strings.Contains(contentType, "application/json") {
			var payload struct {
				ID            string            `json:"id"`
				TransactionID string            `json:"transaction_id"`
				Status        string            `json:"status"`
				Kind          string            `json:"kind"`
				Transaction   *SEP24Transaction `json:"transaction"`
			}
			body, err := io.ReadAll(io.LimitReader(r.Body, sepMaxResponseBytes))
			if err != nil {
				return nil, fmt.Errorf("sep24: failed to read callback body: %w", err)
			}
			if len(bytes.TrimSpace(body)) == 0 {
				return nil, errors.New("sep24: callback body is empty")
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				return nil, fmt.Errorf("sep24: failed to parse callback JSON: %w", err)
			}
			callback.Transaction = payload.Transaction
			callback.TransactionID = firstNonEmpty(payload.TransactionID, payload.ID)
			callback.Status = payload.Status
			callback.Kind = payload.Kind
			if payload.Transaction != nil {
				callback.TransactionID = firstNonEmpty(callback.TransactionID, payload.Transaction.ID)
				callback.Status = firstNonEmpty(callback.Status, payload.Transaction.Status)
				callback.Kind = firstNonEmpty(callback.Kind, payload.Transaction.Kind)
			}
		} else {
			if err := r.ParseForm(); err != nil {
				return nil, fmt.Errorf("sep24: failed to parse callback form: %w", err)
			}
			callback.Query = r.PostForm
			callback.TransactionID = firstNonEmpty(r.PostForm.Get("transaction_id"), r.PostForm.Get("id"))
			callback.Status = r.PostForm.Get("status")
			callback.Kind = firstNonEmpty(r.PostForm.Get("kind"), r.PostForm.Get("type"))
		}
	}

	if callback.Transaction != nil && callback.TransactionID == "" {
		callback.TransactionID = callback.Transaction.ID
	}
	if strings.TrimSpace(callback.TransactionID) == "" {
		return nil, errors.New("sep24: callback is missing a transaction_id")
	}
	if callback.Status != "" {
		if _, err := MapSEP24Status(callback.Status); err != nil {
			return nil, err
		}
	}
	return callback, nil
}

// HandleWebhook routes an anchor callback to its escrow and refreshes the
// internal escrow status from the callback or from the anchor transaction API.
func (c *SEP24Client) HandleWebhook(ctx context.Context, r *http.Request) (EscrowRecord, error) {
	callback, err := ParseWebhookCallback(r)
	if err != nil {
		return EscrowRecord{}, err
	}
	if c.escrows == nil {
		return EscrowRecord{}, errors.New("sep24: escrow store is not configured")
	}

	record, ok := c.escrows.GetEscrowByAnchorTransaction(callback.TransactionID)
	if !ok {
		return EscrowRecord{}, fmt.Errorf("sep24: no escrow found for anchor transaction %s", callback.TransactionID)
	}

	if callback.Transaction != nil {
		return c.UpdateEscrowFromTransaction(ctx, record.EscrowID, callback.Transaction)
	}

	if callback.Status != "" {
		tx := &SEP24Transaction{
			ID:     callback.TransactionID,
			Kind:   firstNonEmpty(callback.Kind, record.Kind),
			Status: callback.Status,
		}
		return c.UpdateEscrowFromTransaction(ctx, record.EscrowID, tx)
	}

	return c.RefreshEscrowStatus(ctx, record.EscrowID)
}

// ParseInteractiveURL validates and parses an anchor-hosted interactive URL.
func ParseInteractiveURL(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("sep24: interactive URL cannot be empty")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("sep24: invalid interactive URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("sep24: interactive URL must be absolute http(s), got scheme %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return nil, errors.New("sep24: interactive URL must include a host")
	}
	if parsed.User != nil {
		return nil, errors.New("sep24: interactive URL must not contain embedded credentials")
	}
	return parsed, nil
}

// TransactionIDFromInteractiveURL extracts the anchor transaction ID carried in
// an interactive URL's query string.
func TransactionIDFromInteractiveURL(raw string) (string, error) {
	parsed, err := ParseInteractiveURL(raw)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	id := firstNonEmpty(query.Get("transaction_id"), query.Get("id"))
	if id == "" {
		return "", errors.New("sep24: interactive URL does not carry a transaction_id")
	}
	return id, nil
}

func (c *SEP24Client) doJSON(ctx context.Context, method, path string, query url.Values, payload, out interface{}) error {
	endpoint := c.transferServer + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}

	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("sep24: failed to encode request body: %w", err)
		}
		body = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return fmt.Errorf("sep24: failed to build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.tokenProvider != nil {
		token, err := c.tokenProvider(ctx)
		if err != nil {
			return fmt.Errorf("sep24: failed to obtain SEP-10 token: %w", err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
	}
	telemetry.InjectTraceContext(ctx, req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.recordRequest(path, "error")
		return fmt.Errorf("sep24: %s %s failed: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, sepMaxResponseBytes))
	if err != nil {
		c.recordRequest(path, "error")
		return fmt.Errorf("sep24: failed to read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.recordRequest(path, "error")
		return &SEPError{
			StatusCode: resp.StatusCode,
			Endpoint:   path,
			Message:    decodeAnchorError(bodyBytes),
		}
	}

	if out != nil {
		if err := json.Unmarshal(bodyBytes, out); err != nil {
			c.recordRequest(path, "error")
			return fmt.Errorf("sep24: failed to parse response JSON: %w", err)
		}
	}
	c.recordRequest(path, "success")
	return nil
}

func (c *SEP24Client) recordRequest(path, status string) {
	if c == nil || c.metrics == nil {
		return
	}
	operation := strings.TrimPrefix(path, "/")
	if operation == "" {
		operation = "unknown"
	}
	c.metrics.RecordAnchorRequest(c.anchorDomain, "sep24_"+operation, status)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
