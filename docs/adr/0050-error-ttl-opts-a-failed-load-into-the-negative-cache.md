# ADR-0050: `errorTtl` opts a failed load into the negative cache

**Status:** accepted (2026-07-16); implemented 2026-07-16. Refines the cache's failure handling (the evict-and-retry invariant that has held since the smart-read design) with an opt-in retention window. Independent of ADR-0020 (endpoint-declared cache policy), which owns *where* the policy lives; this ADR adds one field to that policy's value shape.

## Context

The cache treats every failed load as transient: an error-status Response or a rejected fetch **evicts** the entry at settle, so the next read retries (`cache.ts` `registerEntry` settle handler; `fireRefetch` guards revalidation with the same `!result.ok` check). This is correct for an untyped 5xx or a network blip — blanking a stale value over a hiccup would be a footgun, and serving a cached error for a whole ttl would keep failing after the backend recovered.

But "always retry immediately" is wrong for one class: a backend that is *deliberately* refusing — a 429/503 with a `Retry-After`, an upstream in a cool-down, an expensive endpoint mid-incident. There, every reader that hits the cache miss fires another request at a service that just told you to wait, turning a recovering backend into a thundering herd. There was no way to say "hold this failure briefly."

This ADR is scoped to *transport/backpressure* failures — retaining an error as a **value** the client narrows (a typed domain error like "out of stock") is a separate, larger semantic change and is explicitly out of scope here.

## Decision

Add one optional field to the cache policy value shape (`CacheOptions`, and its endpoint-side twin `CachePolicy`):

```
errorTtl?: number | ((status: number) => number | undefined)
```

- **Unset** → today's evict-and-retry, byte-for-byte unchanged. The feature is fully opt-in; no existing endpoint's behaviour shifts.
- **A number** → retain the failure for that many ms. Reads within the window re-surface the same rejection with **no network**: a buffered Response clone is re-served (raw) or re-decoded to throw the same `HttpError` (decoded), a network `Error` is re-rejected. The entry hard-evicts at the deadline (the existing ttl sweep), so the next read retries.
- **A function of the failed status** → a per-status window, or `undefined` to keep the immediate-retry default for that status. `status` is the HTTP status of the failed Response, or `0` for a network-level fault (fetch rejected — no Response). Lets one endpoint back off a 429/503 while still retrying a 500 at once.
- **`Retry-After`** on the response **overrides** the configured window (parsed as delta-seconds or an HTTP-date), since the server's stated delay is authoritative. Honoured only under an explicit `errorTtl` — never on its own — so opting out stays opt-out.

### Mechanics

The failure is buffered on the entry (`CacheEntry.errorResult`: a pristine `Response` clone the read path re-clones per serve without ever consuming it, or the `Error`), mirroring how the success path clones before decoding (`materializeRetained`). `armTtlExpiry` arms the same eviction sweep a windowed value entry uses; the read path short-circuits on a live `errorResult` and evicts an expired one so the miss below is clean.

A retained error is **never shipped in the SSR snapshot** (`snapshotEntryFromCache` now skips `!response.ok`). Before `errorTtl`, errors evicted at settle and never reached the serializer; retaining them would warm-hydrate a poisoned client entry. The client live-fetches on the miss and runs its own negative cache instead — so `errorTtl` is a per-store backpressure valve, not a cross-side shipped error.

## Consequences

- A new failure-retention mode exists, off by default. The `fn.error()` probe and `settleRefetchFailure`'s keep-stale-on-transient-refresh behaviour are unchanged and compose (the registry records the re-surfaced rejection on each read exactly as a cold one).
- `errorTtl` is meaningful wherever a store outlives a single read: the client tab store and the process-level `shared` server store. A non-shared server entry dies with its request regardless, so retention there is a within-request no-op — harmless, no special-casing.
- Retaining a typed domain error as a cacheable **value** (rather than a re-thrown rejection) remains unbuilt; it would change what `!result.ok` means at settle and deserves its own ADR.
