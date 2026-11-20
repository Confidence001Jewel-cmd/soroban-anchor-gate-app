package telemetry

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	dto "github.com/prometheus/client_model/go"
)

func TestMetrics_PrometheusExpositionFormat(t *testing.T) {
	metrics := NewMetrics()
	metrics.RecordEscrowEvent("received")
	metrics.RecordEscrowEvent("completed")
	metrics.RecordEscrowEvent("completed")
	metrics.RecordRPCError("getEvents")
	metrics.RecordAnchorRequest("anchor.test", "sep24_deposit", "success")
	metrics.ObserveLedgerProcessing(1500 * time.Millisecond)
	metrics.ObserveAnchorPayout("anchor.test", 42*time.Second)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from /metrics, got %d", rec.Code)
	}
	contentType := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(contentType, "text/plain") {
		t.Fatalf("expected Prometheus text exposition content type, got %q", contentType)
	}

	body := rec.Body.String()
	expected := []string{
		"# HELP escrow_events_total",
		"# TYPE escrow_events_total counter",
		`escrow_events_total{status="received"} 1`,
		`escrow_events_total{status="completed"} 2`,
		"# TYPE rpc_errors_total counter",
		`rpc_errors_total{method="getEvents"} 1`,
		"# TYPE anchor_requests_total counter",
		`anchor_requests_total{anchor="anchor.test",operation="sep24_deposit",status="success"} 1`,
		"# TYPE ledger_processing_duration_seconds histogram",
		`ledger_processing_duration_seconds_count{result="success"} 1`,
		`ledger_processing_duration_seconds_sum{result="success"} 1.5`,
		"# TYPE anchor_payout_latency_seconds histogram",
		`anchor_payout_latency_seconds_count{anchor="anchor.test"} 1`,
		`anchor_payout_latency_seconds_sum{anchor="anchor.test"} 42`,
	}
	for _, snippet := range expected {
		if !strings.Contains(body, snippet) {
			t.Errorf("expected /metrics output to contain %q", snippet)
		}
	}
}

func TestMetrics_RegistersRequiredCollectors(t *testing.T) {
	metrics := NewMetrics()
	metrics.RecordEscrowEvent("received")
	metrics.RecordRPCError("getLatestLedger")
	metrics.RecordAnchorRequest("anchor.test", "sep38_prices", "success")
	metrics.ObserveLedgerProcessing(time.Second)
	metrics.ObserveAnchorPayout("anchor.test", time.Minute)

	families, err := metrics.Registry().Gather()
	if err != nil {
		t.Fatalf("Gather error: %v", err)
	}

	byName := make(map[string]*dto.MetricFamily, len(families))
	for _, family := range families {
		byName[family.GetName()] = family
	}

	counterNames := []string{"escrow_events_total", "rpc_errors_total", "anchor_requests_total"}
	for _, name := range counterNames {
		family, ok := byName[name]
		if !ok {
			t.Fatalf("missing counter %s", name)
		}
		if family.GetType() != dto.MetricType_COUNTER {
			t.Errorf("%s should be a counter, got %s", name, family.GetType())
		}
		if len(family.GetMetric()) == 0 {
			t.Errorf("%s has no samples", name)
		}
	}

	histogramNames := []string{"ledger_processing_duration_seconds", "anchor_payout_latency_seconds"}
	for _, name := range histogramNames {
		family, ok := byName[name]
		if !ok {
			t.Fatalf("missing histogram %s", name)
		}
		if family.GetType() != dto.MetricType_HISTOGRAM {
			t.Errorf("%s should be a histogram, got %s", name, family.GetType())
		}
		if len(family.GetMetric()) == 0 || family.GetMetric()[0].GetHistogram() == nil {
			t.Errorf("%s has no histogram samples", name)
		}
	}
}

func TestMetrics_NilSafety(t *testing.T) {
	var metrics *Metrics
	metrics.RecordEscrowEvent("received")
	metrics.RecordRPCError("getEvents")
	metrics.RecordAnchorRequest("anchor.test", "sep24_deposit", "success")
	metrics.ObserveLedgerProcessing(time.Second)
	metrics.ObserveAnchorPayout("anchor.test", time.Second)

	if metrics.Registry() != nil {
		t.Fatal("expected nil registry for nil metrics")
	}

	rec := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for nil metrics handler, got %d", rec.Code)
	}
}

func TestMetrics_EmptyLabelsAreNormalised(t *testing.T) {
	metrics := NewMetrics()
	metrics.RecordEscrowEvent("")
	metrics.RecordRPCError("")
	metrics.RecordAnchorRequest("", "", "")

	families, err := metrics.Registry().Gather()
	if err != nil {
		t.Fatalf("Gather error: %v", err)
	}

	body := &strings.Builder{}
	for _, family := range families {
		switch family.GetName() {
		case "escrow_events_total":
			body.WriteString(family.GetMetric()[0].GetLabel()[0].GetValue())
		case "anchor_requests_total":
			for _, label := range family.GetMetric()[0].GetLabel() {
				body.WriteString(label.GetValue())
			}
		}
	}
	if !strings.Contains(body.String(), "unknown") {
		t.Fatalf("expected empty labels to normalise to 'unknown', got %q", body.String())
	}
}
