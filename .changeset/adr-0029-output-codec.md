---
"@abide/abide": patch
---

Type-directed wire codec — output/response path (ADR-0029)

A handler's structured RETURN values now round-trip to the client instead of being lost or crashing. Previously `json()` serialized via plain `JSON.stringify`, which dropped a `Set`/`Map` to `{}` and threw a 500 on a `bigint`.

- **Server encode (all clients).** `json()` now serializes through a value-directed wire replacer: a `Set` crosses as a JSON array, a `Map` as an array of `[key, value]` entries, a `bigint` as a digit string, a `Date` as an ISO string. The wire stays honest, tag-free JSON, so curl / OpenAPI SDKs read it and it matches the generated schema.
- **Client decode (abide clients).** The warm server program resolves the handler's success-body type to a per-field output plan (`date`/`bigint`/`set`/`map`) and bakes it onto the client `remoteProxy` stub. The proxy revives those fields off a decoded response, so a `Set`/`Map`/`bigint`/`Date` return arrives as the real runtime type. A genuine array is untouched; no plan / an unrevivable value fails open to the honest-JSON form.
- **Projector coherence.** The `ts.Type` → JSON Schema projection now maps `Set<T>` → `array` and `Map<K,V>` → an array of `[K,V]` tuples, so the generated OpenAPI 200 matches the actual bytes.

Deferred: nested/recursive descent, streaming-frame (`jsonl`/`sse`) encoding, and server-side in-process revival.
