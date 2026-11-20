package anchor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newSEP24TestClient(t *testing.T, serverURL string, escrows EscrowStore, opts ...func(*SEP24Config)) *SEP24Client {
	t.Helper()
	cfg := SEP24Config{
		TransferServer: serverURL,
		AnchorDomain:   "anchor.test",
		EscrowStore:    escrows,
		PollInterval:   time.Millisecond,
		PollTimeout:    2 * time.Second,
	}
	for _, opt := range opts {
		opt(&cfg)
	}
	client, err := NewSEP24Client(cfg)
	if err != nil {
		t.Fatalf("NewSEP24Client error: %v", err)
	}
	return client
}

func TestSEP24_DepositInteractiveFlow(t *testing.T) {
	escrows := NewMemoryEscrowStore()

	var depositBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/transactions/deposit/interactive":
			if r.Method != http.MethodPost {
				t.Errorf("unexpected method %s", r.Method)
			}
			if got := r.Header.Get("Authorization"); got != "Bearer test-jwt" {
				t.Errorf("expected SEP-10 bearer token, got %q", got)
			}
			_ = json.NewDecoder(r.Body).Decode(&depositBody)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"type":"interactive_customer_info_needed",
				"url":"https://anchor.test/sep24/interactive?transaction_id=tx-1",
				"id":"tx-1"
			}`))
		case "/transaction":
			_, _ = w.Write([]byte(`{
				"transaction":{
					"id":"tx-1",
					"kind":"deposit",
					"status":"pending_anchor",
					"started_at":"2026-11-20T12:00:00Z",
					"updated_at":"2026-11-20T12:00:05Z"
				}
			}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := newSEP24TestClient(t, server.URL, escrows, func(c *SEP24Config) {
		c.TokenProvider = func(context.Context) (string, error) { return "test-jwt", nil }
	})

	resp, err := client.DepositInteractive(context.Background(), 42, InteractiveTransactionRequest{
		AssetCode: "USDC",
		Amount:    "100",
		Account:   "GCHIAK3LLDWJ5N4Z4TH6GHCH2LQX5SUL2WEU42I324CFXGDUWXMNNSDZ",
	})
	if err != nil {
		t.Fatalf("DepositInteractive error: %v", err)
	}
	if resp.ID != "tx-1" || resp.URL == "" {
		t.Fatalf("unexpected interactive response: %+v", resp)
	}
	if depositBody["asset_code"] != "USDC" || depositBody["amount"] != "100" {
		t.Fatalf("unexpected deposit body: %+v", depositBody)
	}

	record, ok := escrows.GetEscrow(42)
	if !ok {
		t.Fatal("expected escrow record to be persisted")
	}
	if record.Status != EscrowStatusAwaiting || record.AnchorTransactionID != "tx-1" || record.Kind != "deposit" {
		t.Fatalf("unexpected escrow record: %+v", record)
	}
	if record.InteractiveURL != resp.URL {
		t.Fatalf("expected interactive URL to be stored, got %q", record.InteractiveURL)
	}

	// Webhook-less refresh polls the anchor and maps the internal status.
	refreshed, err := client.RefreshEscrowStatus(context.Background(), 42)
	if err != nil {
		t.Fatalf("RefreshEscrowStatus error: %v", err)
	}
	if refreshed.Status != EscrowStatusProcessing {
		t.Fatalf("expected processing status, got %s", refreshed.Status)
	}
	if byTx, ok := escrows.GetEscrowByAnchorTransaction("tx-1"); !ok || byTx.EscrowID != 42 {
		t.Fatal("expected escrow to be indexed by anchor transaction ID")
	}
}

func TestSEP24_WithdrawInteractiveUsesWithdrawEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/transactions/withdraw/interactive" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"type":"interactive_customer_info_needed","url":"https://anchor.test/w?transaction_id=tx-9","id":"tx-9"}`))
	}))
	defer server.Close()

	client := newSEP24TestClient(t, server.URL, NewMemoryEscrowStore())
	if _, err := client.WithdrawInteractive(context.Background(), 7, InteractiveTransactionRequest{AssetCode: "USDC"}); err != nil {
		t.Fatalf("WithdrawInteractive error: %v", err)
	}
}

func TestSEP24_InteractiveErrorResponses(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"unexpected type", `{"type":"something_else","url":"https://anchor.test/x","id":"tx-1"}`},
		{"missing id", `{"type":"interactive_customer_info_needed","url":"https://anchor.test/x"}`},
		{"missing url", `{"type":"interactive_customer_info_needed","id":"tx-1"}`},
		{"relative url", `{"type":"interactive_customer_info_needed","url":"/x","id":"tx-1"}`},
		{"javascript url", `{"type":"interactive_customer_info_needed","url":"javascript:alert(1)","id":"tx-1"}`},
		{"credentials in url", `{"type":"interactive_customer_info_needed","url":"https://user:pass@anchor.test/x","id":"tx-1"}`},
		{"anchor error", `{"error":"invalid asset"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			client := newSEP24TestClient(t, server.URL, NewMemoryEscrowStore())
			if _, err := client.DepositInteractive(context.Background(), 1, InteractiveTransactionRequest{AssetCode: "USDC"}); err == nil {
				t.Fatal("expected interactive response error, got nil")
			}
		})
	}
}

func TestSEP24_RequestValidation(t *testing.T) {
	client := newSEP24TestClient(t, "https://anchor.test", NewMemoryEscrowStore())

	cases := []struct {
		name     string
		escrowID uint64
		req      InteractiveTransactionRequest
	}{
		{"zero escrow", 0, InteractiveTransactionRequest{AssetCode: "USDC"}},
		{"missing asset code", 1, InteractiveTransactionRequest{}},
		{"asset code with issuer", 1, InteractiveTransactionRequest{AssetCode: "USDC:GABCDEF"}},
		{"invalid amount", 1, InteractiveTransactionRequest{AssetCode: "USDC", Amount: "ten"}},
		{"zero amount", 1, InteractiveTransactionRequest{AssetCode: "USDC", Amount: "0"}},
		{"bad memo type", 1, InteractiveTransactionRequest{AssetCode: "USDC", MemoType: "b64", Memo: "x"}},
		{"memo type without memo", 1, InteractiveTransactionRequest{AssetCode: "USDC", MemoType: "text"}},
	}
	for _, tc := range cases {
		if _, err := client.DepositInteractive(context.Background(), tc.escrowID, tc.req); err == nil {
			t.Errorf("%s: expected validation error, got nil", tc.name)
		}
	}
}

func TestSEP24_MapSEP24Status(t *testing.T) {
	cases := map[string]EscrowStatus{
		SEP24StatusIncomplete:             EscrowStatusAwaiting,
		SEP24StatusPendingCustomerInfo:    EscrowStatusAwaiting,
		SEP24StatusPendingUserTransfer:    EscrowStatusAwaiting,
		SEP24StatusPendingUserTransferEnd: EscrowStatusAwaiting,
		SEP24StatusPendingTrust:           EscrowStatusAwaiting,
		SEP24StatusPendingUser:            EscrowStatusAwaiting,
		SEP24StatusPendingExternal:        EscrowStatusProcessing,
		SEP24StatusPendingAnchor:          EscrowStatusProcessing,
		SEP24StatusPendingStellar:         EscrowStatusProcessing,
		SEP24StatusCompleted:              EscrowStatusCompleted,
		SEP24StatusRefunded:               EscrowStatusRefunded,
		SEP24StatusExpired:                EscrowStatusExpired,
		SEP24StatusError:                  EscrowStatusFailed,
		SEP24StatusNoMarket:               EscrowStatusFailed,
		SEP24StatusTooSmall:               EscrowStatusFailed,
		SEP24StatusTooLarge:               EscrowStatusFailed,
	}
	for status, want := range cases {
		got, err := MapSEP24Status(status)
		if err != nil {
			t.Fatalf("MapSEP24Status(%q) error: %v", status, err)
		}
		if got != want {
			t.Errorf("MapSEP24Status(%q) = %s, want %s", status, got, want)
		}
	}

	if _, err := MapSEP24Status("pending_magic"); err == nil {
		t.Fatal("expected error for unknown SEP-24 status")
	}
}

func TestSEP24_TerminalStatus(t *testing.T) {
	terminal := []string{SEP24StatusCompleted, SEP24StatusRefunded, SEP24StatusExpired, SEP24StatusError, SEP24StatusNoMarket, SEP24StatusTooSmall, SEP24StatusTooLarge}
	for _, status := range terminal {
		if !(SEP24Transaction{Status: status}).Terminal() {
			t.Errorf("expected %s to be terminal", status)
		}
	}
	if (SEP24Transaction{Status: SEP24StatusPendingAnchor}).Terminal() {
		t.Error("expected pending_anchor to be non-terminal")
	}
}

func TestSEP24_ParseInteractiveURL(t *testing.T) {
	parsed, err := ParseInteractiveURL("https://anchor.test/sep24?transaction_id=tx-1")
	if err != nil {
		t.Fatalf("ParseInteractiveURL error: %v", err)
	}
	if parsed.Host != "anchor.test" {
		t.Fatalf("unexpected host %q", parsed.Host)
	}

	id, err := TransactionIDFromInteractiveURL("https://anchor.test/sep24?transaction_id=tx-1")
	if err != nil {
		t.Fatalf("TransactionIDFromInteractiveURL error: %v", err)
	}
	if id != "tx-1" {
		t.Fatalf("expected tx-1, got %q", id)
	}

	if _, err := TransactionIDFromInteractiveURL("https://anchor.test/sep24"); err == nil {
		t.Fatal("expected error when interactive URL has no transaction_id")
	}
	for _, bad := range []string{"", "   ", "ftp://anchor.test/x", "https://", "https://u:p@anchor.test/x"} {
		if _, err := ParseInteractiveURL(bad); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}

func TestSEP24_PollTransaction(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		status := SEP24StatusIncomplete
		if calls >= 3 {
			status = SEP24StatusCompleted
		}
		_, _ = fmt.Fprintf(w, `{"transaction":{"id":"tx-1","status":"%s"}}`, status)
	}))
	defer server.Close()

	client := newSEP24TestClient(t, server.URL, NewMemoryEscrowStore())
	tx, err := client.PollTransaction(context.Background(), "tx-1")
	if err != nil {
		t.Fatalf("PollTransaction error: %v", err)
	}
	if tx.Status != SEP24StatusCompleted {
		t.Fatalf("expected completed, got %s", tx.Status)
	}
	if calls != 3 {
		t.Fatalf("expected 3 polls, got %d", calls)
	}
}

func TestSEP24_PollTransactionTimesOut(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"transaction":{"id":"tx-1","status":"pending_anchor"}}`))
	}))
	defer server.Close()

	client := newSEP24TestClient(t, server.URL, NewMemoryEscrowStore(), func(c *SEP24Config) {
		c.PollInterval = 5 * time.Millisecond
		c.PollTimeout = 40 * time.Millisecond
	})
	if _, err := client.PollTransaction(context.Background(), "tx-1"); err == nil {
		t.Fatal("expected polling timeout error, got nil")
	}
}

func TestSEP24_UpdateEscrowFromTransaction(t *testing.T) {
	escrows := NewMemoryEscrowStore()
	client := newSEP24TestClient(t, "https://anchor.test", escrows)

	started := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	completed := started.Add(90 * time.Second)

	if _, err := client.UpdateEscrowFromTransaction(context.Background(), 5, &SEP24Transaction{ID: "tx-5", Status: SEP24StatusPendingAnchor}); err == nil {
		t.Fatal("expected error for unknown escrow")
	}
	if err := escrows.SaveEscrow(EscrowRecord{EscrowID: 5, Status: EscrowStatusAwaiting, AnchorTransactionID: "tx-5"}); err != nil {
		t.Fatalf("SaveEscrow error: %v", err)
	}

	record, err := client.UpdateEscrowFromTransaction(context.Background(), 5, &SEP24Transaction{
		ID:          "tx-5",
		Kind:        "withdraw",
		Status:      SEP24StatusCompleted,
		StartedAt:   started,
		CompletedAt: completed,
	})
	if err != nil {
		t.Fatalf("UpdateEscrowFromTransaction error: %v", err)
	}
	if record.Status != EscrowStatusCompleted || record.Kind != "withdraw" {
		t.Fatalf("unexpected record: %+v", record)
	}
}

func TestSEP24_HandleWebhook(t *testing.T) {
	escrows := NewMemoryEscrowStore()
	if err := escrows.SaveEscrow(EscrowRecord{EscrowID: 11, Status: EscrowStatusAwaiting, AnchorTransactionID: "tx-11", Kind: "deposit"}); err != nil {
		t.Fatalf("SaveEscrow error: %v", err)
	}

	anchorHits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		anchorHits++
		_, _ = w.Write([]byte(`{"transaction":{"id":"tx-11","kind":"deposit","status":"pending_external"}}`))
	}))
	defer server.Close()

	client := newSEP24TestClient(t, server.URL, escrows)

	t.Run("json body with status", func(t *testing.T) {
		body := `{"transaction_id":"tx-11","status":"completed"}`
		req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		record, err := client.HandleWebhook(context.Background(), req)
		if err != nil {
			t.Fatalf("HandleWebhook error: %v", err)
		}
		if record.Status != EscrowStatusCompleted {
			t.Fatalf("expected completed, got %s", record.Status)
		}
	})

	t.Run("json transaction object", func(t *testing.T) {
		body := `{"transaction":{"id":"tx-11","kind":"deposit","status":"pending_external"}}`
		req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		record, err := client.HandleWebhook(context.Background(), req)
		if err != nil {
			t.Fatalf("HandleWebhook error: %v", err)
		}
		if record.Status != EscrowStatusProcessing {
			t.Fatalf("expected processing, got %s", record.Status)
		}
	})

	t.Run("query parameters", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/webhook?transaction_id=tx-11&status=refunded", nil)
		record, err := client.HandleWebhook(context.Background(), req)
		if err != nil {
			t.Fatalf("HandleWebhook error: %v", err)
		}
		if record.Status != EscrowStatusRefunded {
			t.Fatalf("expected refunded, got %s", record.Status)
		}
	})

	t.Run("form body", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader("transaction_id=tx-11&status=expired"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		record, err := client.HandleWebhook(context.Background(), req)
		if err != nil {
			t.Fatalf("HandleWebhook error: %v", err)
		}
		if record.Status != EscrowStatusExpired {
			t.Fatalf("expected expired, got %s", record.Status)
		}
	})

	t.Run("callback without status refreshes from anchor", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(`{"transaction_id":"tx-11"}`))
		req.Header.Set("Content-Type", "application/json")
		record, err := client.HandleWebhook(context.Background(), req)
		if err != nil {
			t.Fatalf("HandleWebhook error: %v", err)
		}
		if record.Status != EscrowStatusProcessing {
			t.Fatalf("expected processing after refresh, got %s", record.Status)
		}
		if anchorHits == 0 {
			t.Fatal("expected the anchor transaction endpoint to be queried")
		}
	})

	t.Run("unknown escrow is rejected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(`{"transaction_id":"tx-unknown","status":"completed"}`))
		req.Header.Set("Content-Type", "application/json")
		if _, err := client.HandleWebhook(context.Background(), req); err == nil {
			t.Fatal("expected error for unknown anchor transaction")
		}
	})
}

func TestSEP24_ParseWebhookCallbackErrors(t *testing.T) {
	cases := []struct {
		name        string
		req         *http.Request
		contentType string
	}{
		{"missing transaction id", httptest.NewRequest(http.MethodGet, "/webhook", nil), ""},
		{"invalid status", httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(`{"transaction_id":"tx-1","status":"pending_magic"}`)), "application/json"},
		{"malformed json", httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(`{`)), "application/json"},
		{"empty json", httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader("")), "application/json"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.contentType != "" {
				tc.req.Header.Set("Content-Type", tc.contentType)
			}
			if _, err := ParseWebhookCallback(tc.req); err == nil {
				t.Fatal("expected callback parse error, got nil")
			}
		})
	}
}

func TestSEP24_AnchorHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"invalid asset"}`, http.StatusBadRequest)
	}))
	defer server.Close()

	client := newSEP24TestClient(t, server.URL, NewMemoryEscrowStore())
	_, err := client.DepositInteractive(context.Background(), 1, InteractiveTransactionRequest{AssetCode: "USDC"})
	if err == nil {
		t.Fatal("expected anchor HTTP error, got nil")
	}
	var sepErr *SEPError
	if !errors.As(err, &sepErr) || sepErr.StatusCode != http.StatusBadRequest || sepErr.Message != "invalid asset" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSEP24_ConstructorValidation(t *testing.T) {
	for _, value := range []string{"", "ftp://anchor.test", "https://"} {
		if _, err := NewSEP24Client(SEP24Config{TransferServer: value}); err == nil {
			t.Errorf("expected error for transfer server %q, got nil", value)
		}
	}

	client, err := NewSEP24Client(SEP24Config{TransferServer: "https://anchor.test/"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.AnchorDomain() != "anchor.test" {
		t.Fatalf("expected derived anchor domain, got %q", client.AnchorDomain())
	}
	if _, err := client.RefreshEscrowStatus(context.Background(), 1); err == nil {
		t.Fatal("expected error when no escrow store is configured")
	}
}
