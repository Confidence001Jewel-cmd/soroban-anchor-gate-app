package telemetry

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// TracerName is the tracer used for relay spans.
const TracerName = "github.com/soroban-anchor-gate/relay"

// TracingConfig configures the relay's OpenTelemetry tracer provider.
type TracingConfig struct {
	// ServiceName is reported as the OTel service.name resource attribute.
	ServiceName string
	// ServiceVersion is reported as service.version.
	ServiceVersion string
	// Environment is reported as deployment.environment.
	Environment string
	// OTLPEndpoint optionally enables OTLP/HTTP trace export, for example
	// "http://localhost:4318". An empty value keeps traces local.
	OTLPEndpoint string
	// SampleRatio is the parent-based trace sampling ratio in [0, 1].
	SampleRatio float64
}

// InitTracer installs the global OpenTelemetry tracer provider and W3C
// Trace Context propagator and returns a shutdown function.
func InitTracer(ctx context.Context, cfg TracingConfig) (func(context.Context) error, error) {
	serviceName := cfg.ServiceName
	if serviceName == "" {
		serviceName = "relay"
	}

	sampleRatio := cfg.SampleRatio
	if sampleRatio <= 0 {
		sampleRatio = 1
	}
	if sampleRatio > 1 {
		sampleRatio = 1
	}

	attributes := []attribute.KeyValue{
		attribute.String("service.name", serviceName),
	}
	if cfg.ServiceVersion != "" {
		attributes = append(attributes, attribute.String("service.version", cfg.ServiceVersion))
	}
	if cfg.Environment != "" {
		attributes = append(attributes, attribute.String("deployment.environment", cfg.Environment))
	}
	res := resource.NewSchemaless(attributes...)

	options := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(sampleRatio))),
	}

	if endpoint := strings.TrimSpace(cfg.OTLPEndpoint); endpoint != "" {
		exporterOptions, err := otlpExporterOptions(endpoint)
		if err != nil {
			return nil, err
		}
		exporter, err := otlptracehttp.New(ctx, exporterOptions...)
		if err != nil {
			return nil, fmt.Errorf("telemetry: failed to create OTLP trace exporter: %w", err)
		}
		options = append(options, sdktrace.WithBatcher(exporter))
	}

	provider := sdktrace.NewTracerProvider(options...)
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return provider.Shutdown, nil
}

func otlpExporterOptions(endpoint string) ([]otlptracehttp.Option, error) {
	trimmed := strings.TrimSpace(endpoint)
	options := []otlptracehttp.Option{}

	parsed, err := url.Parse(trimmed)
	if err == nil && parsed.Scheme != "" {
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return nil, fmt.Errorf("telemetry: unsupported OTLP endpoint scheme %q", parsed.Scheme)
		}
		if parsed.Host == "" {
			return nil, fmt.Errorf("telemetry: OTLP endpoint %q is missing a host", endpoint)
		}
		options = append(options, otlptracehttp.WithEndpoint(parsed.Host))
		if parsed.Scheme == "http" {
			options = append(options, otlptracehttp.WithInsecure())
		}
		if parsed.Path != "" && parsed.Path != "/" {
			options = append(options, otlptracehttp.WithURLPath(parsed.Path))
		}
		return options, nil
	}

	options = append(options, otlptracehttp.WithEndpoint(trimmed), otlptracehttp.WithInsecure())
	return options, nil
}

// Tracer returns the relay tracer.
func Tracer() trace.Tracer {
	return otel.Tracer(TracerName)
}

// ExtractTraceContext reads W3C trace context headers from an inbound request
// and returns a context carrying the remote span context.
func ExtractTraceContext(ctx context.Context, r *http.Request) context.Context {
	if r == nil {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, propagation.HeaderCarrier(r.Header))
}

// InjectTraceContext writes the active span's W3C trace context
// (traceparent/tracestate) onto an outbound request, propagating the trace to
// anchor webhook and API calls.
func InjectTraceContext(ctx context.Context, req *http.Request) {
	if req == nil || ctx == nil {
		return
	}
	if !trace.SpanContextFromContext(ctx).IsValid() {
		return
	}
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
}

// TraceID returns the hex trace ID of the span in ctx, or an empty string.
func TraceID(ctx context.Context) string {
	spanContext := trace.SpanContextFromContext(ctx)
	if !spanContext.IsValid() {
		return ""
	}
	return spanContext.TraceID().String()
}

// Middleware starts a server span for every request, continuing the trace from
// an inbound traceparent header when present.
func Middleware(next http.Handler) http.Handler {
	if next == nil {
		next = http.NotFoundHandler()
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := ExtractTraceContext(r.Context(), r)

		spanName := r.Method + " " + r.URL.Path
		ctx, span := Tracer().Start(ctx, spanName,
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(
				attribute.String("http.request.method", r.Method),
				attribute.String("url.path", r.URL.Path),
				attribute.String("url.scheme", schemeOf(r)),
			),
		)
		defer span.End()

		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r.WithContext(ctx))

		span.SetAttributes(attribute.Int("http.response.status_code", recorder.status))
		if recorder.status >= http.StatusInternalServerError {
			span.SetAttributes(attribute.Bool("error", true))
		}
	})
}

func schemeOf(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if r.URL != nil && r.URL.Scheme != "" {
		return r.URL.Scheme
	}
	return "http"
}

type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if !s.wroteHeader {
		s.status = status
		s.wroteHeader = true
	}
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wroteHeader {
		s.wroteHeader = true
	}
	return s.ResponseWriter.Write(b)
}
