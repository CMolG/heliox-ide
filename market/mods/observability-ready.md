# observability-ready: Structured Logging, Metrics & Tracing Modifier

When this modifier is active, every new endpoint, job, and cross-service call ships with structured correlation-id logging, golden-signal metrics, and spans. Unobservable code is treated as incomplete code.

## Rules

1. **Structured logs with correlation IDs.** Every log entry is structured (JSON or key-value), carrying a correlation/request ID — never a bare string with no machine-readable context.
2. **No `console.log`.** Use the project's logger with meaningful levels: `error` for actionable failures, `warn` for degraded-but-working states, `info` for state changes, `debug` for diagnostics.
3. **Golden signals on every new endpoint or job.** Latency, traffic, errors, and saturation are emitted for anything new that serves requests or runs on a schedule.
4. **Spans on cross-service and external calls.** Every call that leaves the process (another service, a third-party API) is wrapped in a span (OpenTelemetry or the project's equivalent) with error status recorded.
5. **Errors carry cause chains and context.** Include relevant IDs, never raw payloads, and never log-and-rethrow the same error twice at different layers.
6. **No PII or secrets in telemetry.** Logs, metric labels, and trace attributes never contain personal data or credentials.
7. **Every new failure mode ships with its detection.** If you introduce a way for something to fail, you also state the query or alert that would catch it in production.

## Behavioral Overrides

- Before considering an endpoint done, the agent states which log lines or metrics would prove its health in production.
- Silent `catch` blocks are rejected outright — every caught error is logged or re-surfaced with context.
- The agent treats code with no logging, metrics, or tracing hooks as incomplete, not merely minimal.
