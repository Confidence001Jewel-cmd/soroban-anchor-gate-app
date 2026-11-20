package anchor

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func newSEP38TestClient(t *testing.T, serverURL string, now time.Time) *SEP38Client {
	t.Helper()
	client, err := NewSEP38Client(SEP38Config{
		QuoteServer:  serverURL,
		AnchorDomain: "anchor.test",
		Clock:        func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewSEP38Client error: %v", err)
	}
	return client
}

func TestSEP38_GetPrices(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/prices" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		query := r.URL.Query()
		if query.Get("sell_asset") != "iso4217:USD" {
			t.Errorf("unexpected sell_asset %q", query.Get("sell_asset"))
		}
		if query.Get("sell_amount") != "100" {
			t.Errorf("unexpected sell_amount %q", query.Get("sell_amount"))
		}
		if query.Get("context") != "sep24" {
			t.Errorf("unexpected context %q", query.Get("context"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"buy_assets":[{"asset":"stellar:USDC:GABCDEF","price":"0.98","decimals":7}]}`))
	}))
	defer server.Close()

	client := newSEP38TestClient(t, server.URL, time.Now())
	prices, err := client.GetPrices(context.Background(), PriceRequest{
		SellAsset:  "iso4217:USD",
		SellAmount: "100",
		Context:    QuoteContextSEP24,
	})
	if err != nil {
		t.Fatalf("GetPrices error: %v", err)
	}
	if len(prices.BuyAssets) != 1 {
		t.Fatalf("expected 1 buy asset, got %d", len(prices.BuyAssets))
	}
	if prices.BuyAssets[0].Price != "0.98" || prices.BuyAssets[0].Decimals != 7 {
		t.Fatalf("unexpected price entry: %+v", prices.BuyAssets[0])
	}
}

func TestSEP38_GetPricesValidation(t *testing.T) {
	client, err := NewSEP38Client(SEP38Config{QuoteServer: "https://anchor.test"})
	if err != nil {
		t.Fatalf("NewSEP38Client error: %v", err)
	}

	cases := []struct {
		name string
		req  PriceRequest
	}{
		{"no assets", PriceRequest{SellAmount: "10"}},
		{"amount without asset", PriceRequest{SellAmount: "10"}},
		{"invalid amount", PriceRequest{SellAsset: "iso4217:USD", SellAmount: "abc"}},
		{"zero amount", PriceRequest{SellAsset: "iso4217:USD", SellAmount: "0.00"}},
		{"bad context", PriceRequest{SellAsset: "iso4217:USD", Context: "sep99"}},
		{"bad type", PriceRequest{SellAsset: "iso4217:USD", Type: "spot"}},
		{"buy amount without asset", PriceRequest{BuyAmount: "10"}},
	}
	for _, tc := range cases {
		if _, err := client.GetPrices(context.Background(), tc.req); err == nil {
			t.Errorf("%s: expected validation error, got nil", tc.name)
		}
	}
}

func TestSEP38_CreateQuote(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/quote" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["sell_asset"] != "iso4217:USD" || body["sell_amount"] != "100" {
			t.Errorf("unexpected request body: %+v", body)
		}
		if _, ok := body["buy_amount"]; ok {
			t.Errorf("buy_amount must not be sent with sell_amount")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"quote-abc",
			"expires_at":"2026-11-20T12:10:00Z",
			"price":"0.98",
			"total_price":"0.99",
			"sell_asset":"iso4217:USD",
			"sell_amount":"100.00",
			"buy_asset":"stellar:USDC:GABCDEF",
			"buy_amount":"98.00",
			"fee":{"total":"1.00","asset":"iso4217:USD"}
		}`))
	}))
	defer server.Close()

	client := newSEP38TestClient(t, server.URL, time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC))
	quote, err := client.CreateQuote(context.Background(), QuoteRequest{
		SellAsset:   "iso4217:USD",
		BuyAsset:    "stellar:USDC:GABCDEF",
		SellAmount:  "100",
		Context:     QuoteContextSEP24,
		ExpireAfter: 600,
	})
	if err != nil {
		t.Fatalf("CreateQuote error: %v", err)
	}
	if quote.ID != "quote-abc" || quote.BuyAmount != "98.00" || quote.Fee == nil {
		t.Fatalf("unexpected quote: %+v", quote)
	}
	want := time.Date(2026, 11, 20, 12, 10, 0, 0, time.UTC)
	if !quote.ExpiresAt.Equal(want) {
		t.Fatalf("expected expires_at %s, got %s", want, quote.ExpiresAt)
	}
}

func TestSEP38_CreateQuoteValidation(t *testing.T) {
	client, err := NewSEP38Client(SEP38Config{QuoteServer: "https://anchor.test"})
	if err != nil {
		t.Fatalf("NewSEP38Client error: %v", err)
	}

	cases := []struct {
		name string
		req  QuoteRequest
	}{
		{"missing sell asset", QuoteRequest{BuyAsset: "iso4217:USD", BuyAmount: "10"}},
		{"missing buy asset", QuoteRequest{SellAsset: "iso4217:USD", SellAmount: "10"}},
		{"same assets", QuoteRequest{SellAsset: "iso4217:USD", BuyAsset: "iso4217:USD", SellAmount: "10"}},
		{"both amounts", QuoteRequest{SellAsset: "a", BuyAsset: "b", SellAmount: "10", BuyAmount: "10"}},
		{"no amounts", QuoteRequest{SellAsset: "a", BuyAsset: "b"}},
		{"negative-ish amount", QuoteRequest{SellAsset: "a", BuyAsset: "b", SellAmount: "-5"}},
		{"bad context", QuoteRequest{SellAsset: "a", BuyAsset: "b", SellAmount: "5", Context: "sep99"}},
		{"negative expire", QuoteRequest{SellAsset: "a", BuyAsset: "b", SellAmount: "5", ExpireAfter: -1}},
	}
	for _, tc := range cases {
		if _, err := client.CreateQuote(context.Background(), tc.req); err == nil {
			t.Errorf("%s: expected validation error, got nil", tc.name)
		}
	}
}

func TestSEP38_ValidateQuoteExpirationAgainstEscrowDeadline(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	client := newSEP38TestClient(t, "https://anchor.test", now)

	quote := &Quote{ID: "quote-1", ExpiresAt: now.Add(10 * time.Minute)}

	if err := client.ValidateQuoteForEscrow(quote, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("expected quote to outlive deadline, got: %v", err)
	}

	err := client.ValidateQuoteForEscrow(quote, now.Add(20*time.Minute))
	if !errors.Is(err, ErrQuoteExpiryBeforeEscrowDeadline) {
		t.Fatalf("expected deadline error, got: %v", err)
	}

	expired := &Quote{ID: "quote-2", ExpiresAt: now.Add(-time.Second)}
	if err := client.ValidateQuoteForEscrow(expired, time.Time{}); !errors.Is(err, ErrQuoteExpired) {
		t.Fatalf("expected expired error, got: %v", err)
	}

	if err := client.ValidateQuoteForEscrow(nil, now); err == nil {
		t.Fatal("expected error for nil quote")
	}
	if err := client.ValidateQuoteForEscrow(&Quote{ID: ""}, now); !errors.Is(err, ErrQuoteMissingID) {
		t.Fatalf("expected missing ID error, got: %v", err)
	}
	if err := client.ValidateQuoteForEscrow(&Quote{ID: "q"}, now); !errors.Is(err, ErrQuoteMissingExpiry) {
		t.Fatalf("expected missing expiry error, got: %v", err)
	}
}

func TestSEP38_VerifyQuoteID(t *testing.T) {
	if err := VerifyQuoteID("quote-abc", "quote-abc"); err != nil {
		t.Fatalf("expected matching IDs to pass, got: %v", err)
	}
	if err := VerifyQuoteID("quote-abc", "quote-xyz"); !errors.Is(err, ErrQuoteIDMismatch) {
		t.Fatalf("expected mismatch error, got: %v", err)
	}
	if err := VerifyQuoteID("", "quote-abc"); !errors.Is(err, ErrQuoteIDMismatch) {
		t.Fatalf("expected empty reserved ID error, got: %v", err)
	}
	if err := VerifyQuoteID("quote-abc", ""); !errors.Is(err, ErrQuoteMissingID) {
		t.Fatalf("expected missing returned ID error, got: %v", err)
	}
	if err := VerifyQuoteID("quote-abc", "quote-abcd"); !errors.Is(err, ErrQuoteIDMismatch) {
		t.Fatalf("expected prefix mismatch error, got: %v", err)
	}
}

func TestSEP38_AuthorizeEscrowRelease(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)

	t.Run("matching quote authorizes release", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet || r.URL.Path != "/quote/quote-1" {
				t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			}
			_, _ = w.Write([]byte(`{"id":"quote-1","expires_at":"2026-11-20T12:30:00Z","sell_amount":"10","buy_amount":"9.8"}`))
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, now)
		quote, err := client.AuthorizeEscrowRelease(context.Background(), "quote-1", now.Add(10*time.Minute))
		if err != nil {
			t.Fatalf("expected authorized release, got: %v", err)
		}
		if quote.ID != "quote-1" {
			t.Fatalf("unexpected quote: %+v", quote)
		}
	})

	t.Run("tampered quote ID blocks release", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"id":"quote-evil","expires_at":"2026-11-20T12:30:00Z"}`))
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, now)
		if _, err := client.AuthorizeEscrowRelease(context.Background(), "quote-1", time.Time{}); !errors.Is(err, ErrQuoteIDMismatch) {
			t.Fatalf("expected ID mismatch, got: %v", err)
		}
	})

	t.Run("expired quote blocks release", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"id":"quote-1","expires_at":"2026-11-20T11:59:00Z"}`))
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, now)
		if _, err := client.AuthorizeEscrowRelease(context.Background(), "quote-1", time.Time{}); !errors.Is(err, ErrQuoteExpired) {
			t.Fatalf("expected expired quote, got: %v", err)
		}
	})

	t.Run("empty reserved ID is rejected", func(t *testing.T) {
		client := newSEP38TestClient(t, "https://anchor.test", now)
		if _, err := client.AuthorizeEscrowRelease(context.Background(), "  ", time.Time{}); !errors.Is(err, ErrQuoteIDMismatch) {
			t.Fatalf("expected ID mismatch error, got: %v", err)
		}
	})
}

func TestSEP38_ReserveFirmQuote(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		if r.Method != http.MethodPost || r.URL.Path != "/quote/quote-firm" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-jwt" {
			t.Errorf("expected SEP-10 bearer token, got %q", got)
		}
		_, _ = w.Write([]byte(`{"id":"quote-firm","expires_at":"2026-11-20T12:05:00Z","price":"0.98","sell_amount":"10","buy_amount":"9.8"}`))
	}))
	defer server.Close()

	client, err := NewSEP38Client(SEP38Config{
		QuoteServer:   server.URL,
		TokenProvider: func(context.Context) (string, error) { return "test-jwt", nil },
	})
	if err != nil {
		t.Fatalf("NewSEP38Client error: %v", err)
	}

	quote, err := client.ReserveFirmQuote(context.Background(), "quote-firm")
	if err != nil {
		t.Fatalf("ReserveFirmQuote error: %v", err)
	}
	if quote.ID != "quote-firm" || quote.Price != "0.98" {
		t.Fatalf("unexpected firm quote: %+v", quote)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("expected exactly one firm quote call, got %d", calls)
	}
}

func TestSEP38_PollQuote(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)

	t.Run("retries until the anchor persists the quote", func(t *testing.T) {
		var attempts int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if atomic.AddInt32(&attempts, 1) < 3 {
				http.Error(w, `{"error":"quote not found"}`, http.StatusNotFound)
				return
			}
			_, _ = w.Write([]byte(`{"id":"quote-1","expires_at":"2026-11-20T12:30:00Z"}`))
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, now)
		quote, err := client.PollQuote(context.Background(), "quote-1", time.Millisecond)
		if err != nil {
			t.Fatalf("PollQuote error: %v", err)
		}
		if quote.ID != "quote-1" {
			t.Fatalf("unexpected quote: %+v", quote)
		}
		if atomic.LoadInt32(&attempts) != 3 {
			t.Fatalf("expected 3 attempts, got %d", attempts)
		}
	})

	t.Run("returns expired error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"id":"quote-1","expires_at":"2026-11-20T11:00:00Z"}`))
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, now)
		if _, err := client.PollQuote(context.Background(), "quote-1", time.Millisecond); !errors.Is(err, ErrQuoteExpired) {
			t.Fatalf("expected expiry error, got: %v", err)
		}
	})

	t.Run("stops when the context is cancelled", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, now)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
		defer cancel()

		if _, err := client.PollQuote(ctx, "quote-1", 5*time.Millisecond); err == nil {
			t.Fatal("expected context deadline error, got nil")
		}
	})
}

func TestSEP38_AnchorErrorHandling(t *testing.T) {
	t.Run("structured error message", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"unsupported asset pair"}`, http.StatusBadRequest)
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, time.Now())
		_, err := client.CreateQuote(context.Background(), QuoteRequest{SellAsset: "a", BuyAsset: "b", SellAmount: "1"})
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		var sepErr *SEPError
		if !errors.As(err, &sepErr) {
			t.Fatalf("expected SEPError, got %T: %v", err, err)
		}
		if sepErr.StatusCode != http.StatusBadRequest || sepErr.Message != "unsupported asset pair" {
			t.Fatalf("unexpected SEPError: %+v", sepErr)
		}
	})

	t.Run("404 maps to ErrQuoteNotFound", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":"unknown quote"}`, http.StatusNotFound)
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, time.Now())
		if _, err := client.GetQuote(context.Background(), "missing"); !errors.Is(err, ErrQuoteNotFound) {
			t.Fatalf("expected ErrQuoteNotFound, got: %v", err)
		}
	})

	t.Run("quote response without id is rejected", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"expires_at":"2026-11-20T12:30:00Z"}`))
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, time.Now())
		if _, err := client.GetQuote(context.Background(), "q"); !errors.Is(err, ErrQuoteMissingID) {
			t.Fatalf("expected missing ID error, got: %v", err)
		}
	})

	t.Run("quote response without expiry is rejected", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"id":"q"}`))
		}))
		defer server.Close()

		client := newSEP38TestClient(t, server.URL, time.Now())
		if _, err := client.GetQuote(context.Background(), "q"); !errors.Is(err, ErrQuoteMissingExpiry) {
			t.Fatalf("expected missing expiry error, got: %v", err)
		}
	})
}

func TestSEP38_ConstructorValidation(t *testing.T) {
	cases := []string{"", "ftp://anchor.test", "https://", "not a url"}
	for _, value := range cases {
		if _, err := NewSEP38Client(SEP38Config{QuoteServer: value}); err == nil {
			t.Errorf("expected error for quote server %q, got nil", value)
		}
	}

	client, err := NewSEP38Client(SEP38Config{QuoteServer: "https://anchor.test/"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.AnchorDomain() != "anchor.test" {
		t.Fatalf("expected derived anchor domain, got %q", client.AnchorDomain())
	}
}
