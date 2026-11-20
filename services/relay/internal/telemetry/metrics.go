// Package telemetry provides Prometheus metrics and OpenTelemetry trace
// context propagation for the relay daemon.
package telemetry

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics holds every relay Prometheus collector. All recording methods are
// nil-safe so callers can run without instrumentation.
type Metrics struct {
	registry *prometheus.Registry

	escrowEvents     *prometheus.CounterVec
	rpcErrors        *prometheus.CounterVec
	anchorRequests   *prometheus.CounterVec
	ledgerProcessing *prometheus.HistogramVec
	anchorPayout     *prometheus.HistogramVec
}

// NewMetrics builds a relay metrics registry and registers every collector on
// it. A dedicated registry (instead of the Prometheus default one) keeps tests
// isolated and avoids duplicate registration panics.
func NewMetrics() *Metrics {
	registry := prometheus.NewRegistry()

	escrowEvents := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "escrow_events_total",
		Help: "Total number of Soroban escrow events processed by the relay, partitioned by processing outcome.",
	}, []string{"status"})

	rpcErrors := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "rpc_errors_total",
		Help: "Total number of Soroban RPC or Horizon call failures, partitioned by RPC method.",
	}, []string{"method"})

	anchorRequests := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "anchor_requests_total",
		Help: "Total number of anchor HTTP requests issued by the relay, partitioned by anchor, operation and outcome.",
	}, []string{"anchor", "operation", "status"})

	ledgerProcessing := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "ledger_processing_duration_seconds",
		Help:    "Time spent processing a single ledger event window, in seconds.",
		Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
	}, []string{"result"})

	anchorPayout := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "anchor_payout_latency_seconds",
		Help:    "Latency between a SEP-24 transaction starting and its anchor payout completing, in seconds.",
		Buckets: []float64{1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600},
	}, []string{"anchor"})

	registry.MustRegister(
		escrowEvents,
		rpcErrors,
		anchorRequests,
		ledgerProcessing,
		anchorPayout,
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	return &Metrics{
		registry:         registry,
		escrowEvents:     escrowEvents,
		rpcErrors:        rpcErrors,
		anchorRequests:   anchorRequests,
		ledgerProcessing: ledgerProcessing,
		anchorPayout:     anchorPayout,
	}
}

// Registry exposes the underlying Prometheus registry.
func (m *Metrics) Registry() *prometheus.Registry {
	if m == nil {
		return nil
	}
	return m.registry
}

// Handler serves the Prometheus text exposition format at /metrics.
func (m *Metrics) Handler() http.Handler {
	if m == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
			w.WriteHeader(http.StatusOK)
		})
	}
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// RecordEscrowEvent increments escrow_events_total for the given outcome
// (for example "received", "completed" or "failed").
func (m *Metrics) RecordEscrowEvent(status string) {
	if m == nil {
		return
	}
	m.escrowEvents.WithLabelValues(labelOrUnknown(status)).Inc()
}

// RecordRPCError increments rpc_errors_total for a failing RPC method.
func (m *Metrics) RecordRPCError(method string) {
	if m == nil {
		return
	}
	m.rpcErrors.WithLabelValues(labelOrUnknown(method)).Inc()
}

// RecordAnchorRequest increments anchor_requests_total for an anchor call.
func (m *Metrics) RecordAnchorRequest(anchor, operation, status string) {
	if m == nil {
		return
	}
	m.anchorRequests.WithLabelValues(labelOrUnknown(anchor), labelOrUnknown(operation), labelOrUnknown(status)).Inc()
}

// ObserveLedgerProcessing records how long a ledger event window took to
// process.
func (m *Metrics) ObserveLedgerProcessing(duration time.Duration) {
	if m == nil {
		return
	}
	result := "success"
	if duration < 0 {
		duration = 0
		result = "error"
	}
	m.ledgerProcessing.WithLabelValues(result).Observe(duration.Seconds())
}

// ObserveAnchorPayout records the latency of a completed anchor payout.
func (m *Metrics) ObserveAnchorPayout(anchor string, duration time.Duration) {
	if m == nil || duration < 0 {
		return
	}
	m.anchorPayout.WithLabelValues(labelOrUnknown(anchor)).Observe(duration.Seconds())
}

func labelOrUnknown(value string) string {
	if value == "" {
		return "unknown"
	}
	return value
}
