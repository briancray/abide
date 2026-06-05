---
"@briancray/belte": minor
---

Add `belte/test/createTestClient` — an in-process client for testing rpc handlers without a running server. It discovers verbs from the registry (populated by `defineVerb`) and routes through the same synthesize-and-fetch the CLI and MCP surfaces use, but runs each call inside the request scope so request-scoped helpers behave exactly as under a live HTTP request: a fresh per-request `cache()`, the cookie jar with `Set-Cookie` flush, `request()`/`server()` resolution, and `app.handleError` (or the 500 fallback) on a throw. Accepts `headers` to pre-populate inbound auth/cookies and `app` for custom error handling. Pairs with `belte/test/clearVerbRegistry` to isolate suites that define verbs inline. `dispatchVerbInProcess` gains an opt-in `requestScope` flag to back this; the CLI and MCP paths are unchanged.
