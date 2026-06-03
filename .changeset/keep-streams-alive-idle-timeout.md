---
"@briancray/belte": minor
---

Streaming responses (sse / jsonl / socket SSE tail) now opt out of Bun's per-connection idle timeout, so a stream that stays quiet between frames is no longer closed mid-flight. A new `idleTimeout` option (and `BELTE_IDLE_TIMEOUT` env, 0–255 seconds, default 10) sets the floor for ordinary unary handlers that legitimately compute longer than Bun's 10s default.
