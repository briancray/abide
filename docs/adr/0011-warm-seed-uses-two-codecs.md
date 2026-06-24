# ADR-0011: warm-seed uses two codecs by design — HTTP-bound JSON for cache, ref-json for await-resume

**Status:** accepted (2026-06-24)

## Context

Two mechanisms ship a server-computed settled value to the client so hydration
doesn't re-fetch — both answer the same one-line why ("seed warm state across the
wire") and so read, at a glance, like a single feature implemented twice with
conflicting envelopes:

- **Cache warm-seed.** `serializeCacheSnapshot` (top-level `await` reads settled
  by render-return) and `streamCacheResolutions` (streaming `{#await cache()}`
  entries) emit a `CacheSnapshotEntry` as **plain JSON**, injected as `__SSR__`
  inline state or as `__abideResolve(...)` stream chunks. Client intake is one
  sink: `seedStreamedResolution`, drained in `startClient`.
- **Await-block resume.** `renderToStream` encodes each streaming `{#await}`
  block's resolved value with the **ref-json codec** (`encodeRefJson`, which
  preserves `undefined`/cycles/shared refs/`Date`/`Map`), stamped into a
  `<script type="application/json">` inside `<abide-resolve>`, registered into
  the `RESUME` manifest by `applyResolved` / `SSR_SWAP_SCRIPT`, and decoded
  **lazily, in-component** by `awaitBlock`.

An architecture pass flagged this as a fracture worth unifying: one codec, one
intake. The intake half was real and got unified (see Decision). The codec half
is **not** a fracture — it is forced by what each value *is*, and trying to merge
it is actively wrong, not merely unnecessary. This ADR records why, so the split
isn't re-litigated.

Shapes considered and rejected:

- **Make the cache snapshot use ref-json too (one codec everywhere).** The cache
  value's fidelity is capped at plain JSON by the **entire HTTP read path**, not
  just the snapshot. `CacheSnapshotEntry.body` is the raw HTTP response text; the
  warm value is `JSON.parse(body)` (`cacheEntryFromSnapshot`), and the *live*
  read of that same key decodes the same `Response` via `response.json()`
  (`decodeResponse`) — plain JSON, bound to agree by the shared `contentBodyKind`
  invariant. ref-json on the **response direction does not exist** in abide: the
  `REF_JSON_HEADER` codec is request/args-direction only (`buildRpcRequest` →
  `parseArgs`). Encoding the snapshot as ref-json would make the warm value
  richer than the live re-fetch of the same key can ever be — desyncing
  warm-vs-live and recovering nothing a JSON HTTP body already dropped.
- **Unify the two backing stores.** The cache store is keyed by cache key
  (method+url); the `RESUME` manifest is keyed by await-boundary id. Different
  identities, different lifetimes (a cache entry revalidates; a resume entry is
  consumed once at adoption). One store would need both key spaces and both
  lifecycles.
- **Decode await-resume eagerly at seed time (like the cache channel).** The
  inline `SSR_SWAP_SCRIPT` runs **before the bundle's codec loads** — it can only
  stash the raw ref-json string. Decode is necessarily deferred to the
  `awaitBlock` read site, where the codec is available. Eager decode would
  reintroduce a bundle-before-swap ordering dependency the streaming protocol is
  built to avoid.

## Decision

**Unify the client intake registration; keep the codec and stores split.**

All bundle-side warm-seed registration flows through one seam, `seedResolved`,
which dispatches by source:

```ts
seedResolved({ kind: 'cache', resolution })  // → cache store, via seedStreamedResolution
seedResolved({ kind: 'resume', id, resume })  // → RESUME manifest (raw ref-json string)
```

After this, the bundle has exactly one write door per store: the only
`seedStreamedResolution` caller (outside its own module) and the only `RESUME[…] =`
write both live inside `seedResolved`. The inline `SSR_SWAP_SCRIPT` still writes
`__abideResume` directly **by necessity** (it predates the bundle), so the seam is
the single *bundle-side* intake, not the only writer in the system.

The **codec stays split** along the value's nature:

- A **cache** value is an HTTP payload. Its warm seed must round-trip exactly as
  its live re-fetch would, so it is plain JSON, end to end. Making the cache
  response direction ref-json-capable is a protocol change (touches
  `decodeResponse`, `contentBodyKind`, every remote read, and the non-abide-client
  plain-JSON fallback the `REF_JSON_HEADER` guards) that would put non-standard
  bytes on ordinary JSON API responses — counter to the "based on web standards"
  goal — and is out of scope here.
- An **await-resume** value is an in-process render-time value graph, never
  HTTP-serialized, so ref-json genuinely earns its keep (cycles, `undefined`,
  rich types) and the raw-string-plus-lazy-decode shape is required by the
  before-bundle swap timing.

## Consequences

- The intake seam is internal plumbing (not in the `exports` map): one registration
  point, no public-surface or AGENTS.md churn.
- The two codecs are a **correctness boundary**, not duplication: plain JSON for
  anything that must agree with an HTTP re-fetch, ref-json for in-process value
  graphs. A future warm-seed source picks its codec by that test, not by
  preference.
- Unifying the codec is gated on first migrating the RPC/cache **response**
  direction to ref-json — a protocol change with its own ADR, justified only if a
  concrete need to carry non-JSON types through cached HTTP reads appears. Until
  then, the split stands and should not be re-flagged as accidental divergence.
- The known mid-stream timing trap is unaffected: a `{#await cache()}` entry is
  created during streaming, after render-return, so `serializeCacheSnapshot` is
  empty for it and it seeds via the post-render `__abideResolve` chunk path. That
  is a property of *when* the entry exists, orthogonal to the codec choice.
