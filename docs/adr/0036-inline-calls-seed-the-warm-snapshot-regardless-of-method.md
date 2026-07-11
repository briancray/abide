# ADR-0036: An inline call seeds the SSR warm snapshot regardless of method

**Status:** **accepted — shipped** (2026-07-11). A server-side codegen/runtime change only: the
SSR→client wire (`__SSR__` / `__abideResolve`), the client hydration path
(`cacheEntryFromSnapshot` / `seedStreamedResolution`), and the block-id/RESUME contract are all
untouched. Refines the warm-snapshot machinery of
[ADR-0024](0024-ssr-auto-streaming-bare-reads.md) (auto-streaming bare reads) and the endpoint
cache policy of [ADR-0020](0020-cache-policy-on-the-endpoint.md). Independent of ADR-0034's flight
hoisting.

## Context

The SSR warm snapshot ships each cache entry the server resolved during render into the HTML, so
the client hydrates warm instead of re-issuing the call after render. Which entries ship was gated
on `REPLAYABLE_METHODS` — `{ GET }` only. A bare smart read of a **non-GET** rpc consumed inline in
render position (`{html(highlightCode({ code, lang })?.html)}`, where `highlightCode` is a `POST`)
therefore:

1. ran the handler **in-process during SSR** (the value baked into the shell), but
2. was **excluded from the snapshot**, so on the client the first bare read missed and **re-fetched
   after hydration**.

Result: a page load fired the call **twice** — once during render, once after — which for a real
mutation is worse than a warning (a second `POST` can 500 on a unique constraint, double-charge,
etc.). This was reported against `examples/kitchen-sink` `rpc/request-scope`, whose `CodeBlock`
highlights via a `POST` rpc (POST so the large `code` payload rides the request body, not a
multi-KB query string).

The root cause was a **conflation**: the `{ GET }` gate governed two different things through one
flag —

- **Seeding** — shipping the SSR-computed body so the client reads it warm and does **not** re-issue
  the call. Safe for **any** method that produced a serializable body: the value already exists;
  shipping it avoids a round-trip.
- **Re-firing unprompted** — a hydrated snapshot entry carries a reconstructed `Request`
  (`cacheEntryFromSnapshot`), which `cache.refresh` / `cache.invalidate` / access-triggered
  staleness can replay via `fetch(request.clone())`. Safe **only** for GET (idempotent, read-only);
  replaying a POST re-mutates.

Because seeding was gated on the re-firing predicate, the client re-issued exactly the methods that
are **dangerous** to re-issue (writes) and read-warm exactly the methods that are **safe** to
re-issue (GET). The safety logic ran backwards.

## Decision

**Decouple the two.** Seeding is gated on "the entry carries a wire request" (any method);
re-firing stays GET-only.

- New predicate `hasSeedableRequest(entry)` = `entry.request !== undefined`, replacing
  `hasReplayableRequest` at every snapshot-selection site (`snapshotShippable`,
  `snapshotEntryFromCache`, and the renderer's render-return + streaming-drain filters). Producers
  (no request) and streaming cells (a `NamedAsyncIterable` holds no wire request) still fail it and
  stay `peek()`-at-flush; binary/streaming bodies still drop at the response-level gate.
- `CacheSnapshotEntry.method` widened `ReplayableMethod` → `HttpMethod`.
- `REPLAYABLE_METHODS` / `isReplayableMethod` / `ReplayableMethod` are **unchanged** and still gate
  the client re-fire paths in `cache.ts`: a non-GET smart read is still `coalesceOnly` (ttl 0, the
  mutation idiom — a write stays re-submittable), never SWR-retained, and never auto-revalidated. A
  seeded POST is read warm **once** during hydration, then its ttl-0 hydrated entry evicts a
  macrotask later (a subsequent reactive re-read re-issues live, with real args) — it is never
  auto-replayed from the snapshot.

The consuming author owns idempotence. An inline call in render position is being *used* as a read;
if it is a genuine mutation whose SSR-time execution is wrong (a receipt baked into cacheable HTML,
a single-use token, a per-visitor side effect), that is a mutation-in-render mistake to author
around — the framework fires it **once** (at SSR) and hydrates warm, rather than firing it twice.

## Consequences

- The reported double-fire is gone: an inline POST seeds and the client hydrates warm with **zero**
  post-hydration refetch (verified on `rpc/request-scope`: 0 browser requests to
  `/rpc/highlightCode`).
- `keyForRemoteCall` already keys POST/PUT/PATCH on canonical-JSON body args, so each inline write
  seeds and matches under its own distinct key — no cross-call collision.
- Seeding a write embeds its response body in the page HTML. For a body that must **not** be
  embedded (a secret, a single-use token) or a side effect that must run **per client** (analytics,
  a counter), an inline bare call remains the wrong shape — put the mutation in an event
  handler/explicit action, where it fires once on intent and never seeds. This ADR makes the
  accidental case fire-once instead of fire-twice; it does not make bare-calling a mutation in
  render *correct*.

## Rejected alternatives

- **Invert `REPLAYABLE_METHODS`** (seed POST, re-run GET). Trades one wrong behavior for two: it
  deletes the warm-seed round-trip saving for the common, safe GET case, and enshrines a mutation
  firing during SSR render on every page GET as the *default*.
- **Opt-in `POST(fn, { cache: { replayable: true } })`.** Keys seedability on an author declaration
  rather than the verb — clean, but it re-invents "this is a GET" and leaves the accidental
  bare-POST double-fire in place for everyone who doesn't set the flag. Decoupling seed from replay
  fixes the default; an explicit idempotence flag can still be layered later if a call needs
  seed-**and**-safe-replay.
- **Guardrail: warn/throw on a non-GET bare smart read in render position.** Considered, not taken:
  the maintainer's cases (an idempotent read that carries a body — e.g. highlight a large snippet,
  search a complex filter) are legitimate, and a hard gate on the verb would reject them. The
  fire-once seed is the pragmatic default; authoring defensively covers the rest.
