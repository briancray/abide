---
"@abide/abide": minor
---

OpenTelemetry export over the standard variables. With `OTEL_EXPORTER_OTLP_ENDPOINT` (or a signal's own endpoint) set, every line the app logs is sent as an OTLP log record and every span as an OTLP span — each request the root span of its trace, under the id `traceresponse` names — as OTLP/HTTP JSON, batched each second, carrying `OTEL_EXPORTER_OTLP_HEADERS` and named by `OTEL_SERVICE_NAME` or `APP_NAME`. Unset, nothing is sent; `OTEL_SDK_DISABLED=true` turns it off. RULEBOOK 36.19-36.23.
