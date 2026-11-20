package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
)

const testTraceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

func TestMiddlewareContinuesInboundTrace(t *testing.T) {
	ctx := context.Background()
	shutdown, err := InitTracer(ctx, TracingConfig{ServiceName: "relay-test", SampleRatio: 1})
	if err != nil {
		t.Fatalf("InitTracer error: %v", err)
	}
	defer func() { _ = shutdown(ctx) }()

	var handlerTraceID string
	var handlerMethod string
	handler := Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerTraceID = TraceID(r.Context())
		handlerMethod = r.Method
		w.WriteHeader(http.StatusAccepted)
	}))

	req := httptest.NewRequest(http.MethodPost, "/webhooks/anchor", nil)
	req.Header.Set("traceparent", testTraceparent)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202 to pass through, got %d", rec.Code)
	}
	if handlerMethod != http.MethodPost {
		t.Fatalf("expected request to reach handler, got method %q", handlerMethod)
	}
	if handlerTraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Fatalf("expected inbound trace ID to be continued, got %q", handlerTraceID)
	}
}

func TestMiddlewareStartsTraceWithoutInboundContext(t *testing.T) {
	ctx := context.Background()
	shutdown, err := InitTracer(ctx, TracingConfig{ServiceName: "relay-test", SampleRatio: 1})
	if err != nil {
		t.Fatalf("InitTracer error: %v", err)
	}
	defer func() { _ = shutdown(ctx) }()

	var traceID string
	handler := Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID = TraceID(r.Context())
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/health", nil))

	if traceID == "" {
		t.Fatal("expected the middleware to start a new trace")
	}
	if len(traceID) != 32 {
		t.Fatalf("expected a 32 character hex trace ID, got %q", traceID)
	}
}

func TestInjectTraceContextPropagatesToOutboundRequests(t *testing.T) {
	ctx := context.Background()
	shutdown, err := InitTracer(ctx, TracingConfig{ServiceName: "relay-test", SampleRatio: 1})
	if err != nil {
		t.Fatalf("InitTracer error: %v", err)
	}
	defer func() { _ = shutdown(ctx) }()

	spanCtx, span := Tracer().Start(ctx, "anchor webhook")
	defer span.End()

	req, err := http.NewRequestWithContext(spanCtx, http.MethodGet, "https://anchor.test/transaction?id=tx-1", nil)
	if err != nil {
		t.Fatalf("NewRequest error: %v", err)
	}
	InjectTraceContext(spanCtx, req)

	traceparent := req.Header.Get("traceparent")
	if traceparent == "" {
		t.Fatal("expected traceparent header on outbound request")
	}
	if !strings.Contains(traceparent, TraceID(spanCtx)) {
		t.Fatalf("expected traceparent %q to carry trace ID %q", traceparent, TraceID(spanCtx))
	}

	// A downstream extractor must recover the same trace.
	extracted := ExtractTraceContext(context.Background(), req)
	if TraceID(extracted) != TraceID(spanCtx) {
		t.Fatalf("expected extracted trace ID %q, got %q", TraceID(spanCtx), TraceID(extracted))
	}
}

func TestInjectTraceContextWithoutSpanIsNoop(t *testing.T) {
	otel.SetTextMapPropagator(otel.GetTextMapPropagator())

	req, err := http.NewRequest(http.MethodGet, "https://anchor.test/transaction", nil)
	if err != nil {
		t.Fatalf("NewRequest error: %v", err)
	}
	InjectTraceContext(context.Background(), req)
	if got := req.Header.Get("traceparent"); got != "" {
		t.Fatalf("expected no traceparent header, got %q", got)
	}
	InjectTraceContext(context.Background(), nil)
}

func TestMiddlewareRecordsErrorStatus(t *testing.T) {
	ctx := context.Background()
	shutdown, err := InitTracer(ctx, TracingConfig{ServiceName: "relay-test"})
	if err != nil {
		t.Fatalf("InitTracer error: %v", err)
	}
	defer func() { _ = shutdown(ctx) }()

	handler := Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/events", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500 to pass through, got %d", rec.Code)
	}
}

func TestInitTracerRejectsUnsupportedEndpoint(t *testing.T) {
	if _, err := InitTracer(context.Background(), TracingConfig{
		ServiceName:  "relay-test",
		OTLPEndpoint: "ftp://collector.example:4318",
	}); err == nil {
		t.Fatal("expected error for unsupported OTLP scheme, got nil")
	}
}

func TestInitTracerAcceptsOTLPEndpoint(t *testing.T) {
	shutdown, err := InitTracer(context.Background(), TracingConfig{
		ServiceName:    "relay-test",
		ServiceVersion: "1.2.3",
		Environment:    "test",
		OTLPEndpoint:   "http://collector.example:4318",
	})
	if err != nil {
		t.Fatalf("InitTracer error: %v", err)
	}
	defer func() { _ = shutdown(context.Background()) }()
}
