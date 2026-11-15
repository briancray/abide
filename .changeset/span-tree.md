---
"@abide/abide": minor
---

A span's `LogRecord` carries `span`: its own id, the span it opened under, its name, kind, duration, status and attributes, so the lines of one trace form a tree (RULEBOOK 24.9). With `DEBUG=abide:request` each request is written as the root `server` span, under the id `traceresponse` names and the caller's `traceparent` (24.10).
