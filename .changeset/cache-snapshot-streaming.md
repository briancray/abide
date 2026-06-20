---
"@abide/abide": patch
---

fix(cache): honor the streaming guard in the SSR cache-snapshot round-trip. The snapshot path's content-type classifiers were hand-mirrored against `decodeResponse` but omitted its `isStreamingResponse` refusal, so a `cache()`d GET to a streaming endpoint (SSE / NDJSON / JSONL) would (a) hang SSR — `snapshotEntryFromCache` called `response.text()` on a never-ending body — and (b) break isomorphism — `warmValueFromSnapshot` warm-decoded the body to a value while a live read throws the "use tail()/stream()" error. The server now skips streaming responses (shared `isStreamingResponse`) and the warm decoder defers them to the async path, keeping it a strict subset of `decodeResponse`.
