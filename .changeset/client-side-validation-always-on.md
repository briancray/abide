---
"@abide/abide": minor
---

Client-side input validation, always on (ADR-0026). When an rpc endpoint declares `schemas: { input }`, the client `remoteProxy` now validates the typed args against that schema before the fetch and, on a definitive failure, throws an `HttpError` shaped identically to the server's 422 (`kind: 'validation'`, the same field-error `data`) — no round-trip. A validator that *throws* (a non-portable / async-resource refinement that can't run in the browser) falls through to the server instead of failing the call, so adding a schema can never break a request. Server validation stays authoritative and unconditional — the client check is a UX optimization only. No configuration: it runs whenever an input schema is present.
