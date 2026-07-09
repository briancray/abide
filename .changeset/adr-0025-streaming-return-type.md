---
"@abide/abide": patch
---

Streaming rpc detection resolves through a warm `ts.Program` (ADR-0025). Whether a handler streams (returns `jsonl()`/`sse()`) is now decided by the handler's **return type** via a warm per-project-root program, instead of scanning the handler body for the call name — which fixes the wrapper-indirection blind spot where a handler returning a stream through a helper function was misclassified as a point read on the client. Built once per project root (a one-time boot cost, reused across every rpc in the build) and **fails open** to the previous char-scan.
