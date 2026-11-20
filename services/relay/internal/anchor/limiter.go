package anchor

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"

	"golang.org/x/time/rate"
)

// LimitConfig defines the rate and burst thresholds for an anchor endpoint.
type LimitConfig struct {
	// RPS defines the sustained requests per second allowed.
	RPS float64 `json:"rps"`
	// Burst defines the maximum burst capacity.
	Burst int `json:"burst"`
}

// Config defines the global and per-anchor rate limiting configuration.
type Config struct {
	// DefaultRPS applies when no anchor-specific rate is defined. Defaults to 5.0.
	DefaultRPS float64 `json:"default_rps"`
	// DefaultBurst applies when no anchor-specific burst is defined. Defaults to 10.
	DefaultBurst int `json:"default_burst"`
	// Anchors maps anchor domain names to their custom rate limits.
	Anchors map[string]LimitConfig `json:"anchors"`
}

// DefaultConfig provides sensible production defaults for anchor throttling.
func DefaultConfig() Config {
	return Config{
		DefaultRPS:   5.0,
		DefaultBurst: 10,
		Anchors:      make(map[string]LimitConfig),
	}
}

// LoadConfig reads anchor rate limit configurations from a JSON file.
func LoadConfig(filePath string) (Config, error) {
	cfg := DefaultConfig()
	data, err := os.ReadFile(filePath)
	if err != nil {
		return cfg, fmt.Errorf("failed to read anchor limiter config file: %w", err)
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("failed to parse anchor limiter config json: %w", err)
	}
	if cfg.DefaultRPS <= 0 {
		cfg.DefaultRPS = 5.0
	}
	if cfg.DefaultBurst <= 0 {
		cfg.DefaultBurst = 10
	}
	return cfg, nil
}

// Limiter manages per-anchor domain token-bucket rate limiters.
type Limiter struct {
	cfg      Config
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
}

// NewLimiter initializes a per-anchor rate limiter from configuration.
func NewLimiter(cfg Config) *Limiter {
	if cfg.DefaultRPS <= 0 {
		cfg.DefaultRPS = 5.0
	}
	if cfg.DefaultBurst <= 0 {
		cfg.DefaultBurst = 10
	}
	if cfg.Anchors == nil {
		cfg.Anchors = make(map[string]LimitConfig)
	}
	return &Limiter{
		cfg:      cfg,
		limiters: make(map[string]*rate.Limiter),
	}
}

// normalizeDomain strips scheme and port to isolate the domain hostname.
func normalizeDomain(domain string) string {
	d := strings.ToLower(strings.TrimSpace(domain))
	d = strings.TrimPrefix(d, "https://")
	d = strings.TrimPrefix(d, "http://")
	if idx := strings.Index(d, "/"); idx != -1 {
		d = d[:idx]
	}
	if idx := strings.Index(d, ":"); idx != -1 {
		d = d[:idx]
	}
	return d
}

// GetLimiter returns or creates the token-bucket rate limiter for the specified anchor domain.
func (l *Limiter) GetLimiter(domain string) *rate.Limiter {
	norm := normalizeDomain(domain)

	l.mu.RLock()
	lim, exists := l.limiters[norm]
	l.mu.RUnlock()
	if exists {
		return lim
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	// Double-check after acquiring write lock
	if lim, exists := l.limiters[norm]; exists {
		return lim
	}

	rps := l.cfg.DefaultRPS
	burst := l.cfg.DefaultBurst

	if custom, ok := l.cfg.Anchors[norm]; ok {
		if custom.RPS > 0 {
			rps = custom.RPS
		}
		if custom.Burst > 0 {
			burst = custom.Burst
		}
	}

	lim = rate.NewLimiter(rate.Limit(rps), burst)
	l.limiters[norm] = lim
	return lim
}

// Wait blocks until the rate limiter allows one event for the given anchor domain,
// or returns an error if the context is canceled.
func (l *Limiter) Wait(ctx context.Context, domain string) error {
	return l.GetLimiter(domain).Wait(ctx)
}

// Allow reports whether one event can occur immediately for the given anchor domain.
func (l *Limiter) Allow(domain string) bool {
	return l.GetLimiter(domain).Allow()
}

// ThrottledRoundTripper wraps an existing http.RoundTripper with domain-aware rate limiting.
type ThrottledRoundTripper struct {
	base    http.RoundTripper
	limiter *Limiter
}

// NewThrottledRoundTripper wraps an http.RoundTripper with rate limiting.
func NewThrottledRoundTripper(base http.RoundTripper, limiter *Limiter) *ThrottledRoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return &ThrottledRoundTripper{
		base:    base,
		limiter: limiter,
	}
}

// RoundTrip executes an HTTP request after acquiring permission from the anchor's rate limiter.
func (t *ThrottledRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	domain := req.URL.Hostname()
	if domain == "" {
		domain = req.URL.Host
	}

	if err := t.limiter.Wait(req.Context(), domain); err != nil {
		return nil, fmt.Errorf("rate limiter wait failed: %w", err)
	}

	return t.base.RoundTrip(req)
}

// WrapClient configures an http.Client's transport with the anchor rate limiter.
func (l *Limiter) WrapClient(client *http.Client) *http.Client {
	if client == nil {
		client = &http.Client{}
	}
	transport := client.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	client.Transport = NewThrottledRoundTripper(transport, l)
	return client
}
