---
"@abide/abide": patch
---

SSR hydration payload ships as inert JSON instead of executable JavaScript (ADR-0051)

The `window.__SSR__` boot payload now ships as `<script type="application/json">` parsed once by the deferred client bundle with `JSON.parse`, rather than a `window.__SSR__ = {…}` statement the browser had to compile and evaluate as a multi-MB program on the critical path. The global still exists for debugging — the bundle republishes it after parsing. Additionally, a json cache body is now seeded pre-parsed (`data`) rather than as a re-escaped JSON string nested in the payload, so it's single-encoded (roughly half the wire bytes and gzip for a json-heavy grid) and read without a second parse. Warm-seed semantics — zero refetch, zero hydration divergence — are unchanged.
