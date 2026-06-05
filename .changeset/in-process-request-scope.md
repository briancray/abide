---
"@briancray/belte": minor
---

Run in-process rpc dispatch inside the request scope for the MCP tool dispatcher and the in-process CLI client. Previously both invoked handlers without a per-request scope, so `cache()` silently shared one process-wide store across calls (leaking state between unrelated tool/CLI invocations) and `cookies()`/`request()` threw. Both now cross the same `runWithRequestScope` seam the HTTP router uses, giving per-call cache isolation and resolving the scope-bound helpers.

Behavior change for MCP: a tool handler that throws is now caught by the scope and returned as a tool result with `isError: true` (framed from the 500 response), instead of surfacing as a JSON-RPC `-32603` error on the envelope. The JSON-RPC call itself succeeds; the failure is reported at the tool-result level, which is the correct MCP shape.
