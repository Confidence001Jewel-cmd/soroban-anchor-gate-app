package anchor

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLimiter_EnforcesDelayAfterBurst(t *testing.T) {
	cfg := Config{
		DefaultRPS:   10.0, // 100ms per token
		DefaultBurst: 2,
		Anchors:      make(map[string]LimitConfig),
	}
	lim := NewLimiter(cfg)
	domain := "anchor.stellar.org"

	ctx := context.Background()

	// First 2 requests consume the burst immediately
	for i := 0; i < 2; i++ {
		start := time.Now()
		if err := lim.Wait(ctx, domain); err != nil {
			t.Fatalf("unexpected Wait error on request %d: %v", i, err)
		}
		if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
			t.Errorf("burst request %d took too long: %v", i, elapsed)
		}
	}

	// 3rd request should be throttled and incur ~100ms delay
	start := time.Now()
	if err := lim.Wait(ctx, domain); err != nil {
		t.Fatalf("unexpected Wait error on throttled request: %v", err)
	}
	elapsed := time.Since(start)
	if elapsed < 70*time.Millisecond {
		t.Errorf("expected throttling delay of ~100ms, but completed in %v", elapsed)
	}
}

func TestLimiter_PerAnchorOverrides(t *testing.T) {
	cfg := Config{
		DefaultRPS:   2.0,
		DefaultBurst: 2,
		Anchors: map[string]LimitConfig{
			"fast-anchor.com": {
				RPS:   50.0,
				Burst: 20,
			},
			"slow-anchor.com": {
				RPS:   1.0,
				Burst: 1,
			},
		},
	}
	lim := NewLimiter(cfg)

	fastLim := lim.GetLimiter("fast-anchor.com")
	if fastLim.Burst() != 20 {
		t.Errorf("expected burst 20 for fast-anchor, got %d", fastLim.Burst())
	}
	if float64(fastLim.Limit()) != 50.0 {
		t.Errorf("expected limit 50 for fast-anchor, got %f", float64(fastLim.Limit()))
	}

	slowLim := lim.GetLimiter("https://slow-anchor.com:8443/sep24")
	if slowLim.Burst() != 1 {
		t.Errorf("expected burst 1 for slow-anchor, got %d", slowLim.Burst())
	}

	defaultLim := lim.GetLimiter("other-anchor.com")
	if defaultLim.Burst() != 2 {
		t.Errorf("expected default burst 2, got %d", defaultLim.Burst())
	}
}

func TestLimiter_ContextCancellation(t *testing.T) {
	cfg := Config{
		DefaultRPS:   0.1, // 1 request every 10 seconds
		DefaultBurst: 1,
		Anchors:      make(map[string]LimitConfig),
	}
	lim := NewLimiter(cfg)
	domain := "slow.example.com"

	// Exhaust burst
	if err := lim.Wait(context.Background(), domain); err != nil {
		t.Fatalf("unexpected burst error: %v", err)
	}

	// Attempt wait with quick timeout
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := lim.Wait(ctx, domain)
	if err == nil {
		t.Fatal("expected context timeout error, got nil")
	}
}

func TestLimiter_LoadConfig(t *testing.T) {
	jsonContent := `{
		"default_rps": 15.0,
		"default_burst": 25,
		"anchors": {
			"api.anchor.net": {
				"rps": 2.5,
				"burst": 5
			}
		}
	}`
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "anchors.json")
	if err := os.WriteFile(configPath, []byte(jsonContent), 0644); err != nil {
		t.Fatalf("failed to write test config file: %v", err)
	}

	cfg, err := LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig error: %v", err)
	}

	if cfg.DefaultRPS != 15.0 || cfg.DefaultBurst != 25 {
		t.Errorf("unexpected defaults: RPS=%f, Burst=%d", cfg.DefaultRPS, cfg.DefaultBurst)
	}

	anchorCfg, ok := cfg.Anchors["api.anchor.net"]
	if !ok || anchorCfg.RPS != 2.5 || anchorCfg.Burst != 5 {
		t.Errorf("unexpected anchor config: %+v", anchorCfg)
	}
}

func TestLimiter_ThrottledHTTPClient(t *testing.T) {
	requestsHandled := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestsHandled++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer server.Close()

	cfg := Config{
		DefaultRPS:   20.0,
		DefaultBurst: 5,
		Anchors:      make(map[string]LimitConfig),
	}
	lim := NewLimiter(cfg)
	client := lim.WrapClient(server.Client())

	for i := 0; i < 3; i++ {
		resp, err := client.Get(server.URL + "/sep38/prices")
		if err != nil {
			t.Fatalf("HTTP request %d failed: %v", i, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if string(body) != "ok" {
			t.Errorf("unexpected body: %s", string(body))
		}
	}

	if requestsHandled != 3 {
		t.Errorf("expected 3 requests handled, got %d", requestsHandled)
	}
}
