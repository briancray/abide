# ADR-0051: the `__SSR__` payload ships as inert JSON, cache bodies single-encoded

**Status:** accepted (2026-07-16); implemented 2026-07-16. Refines how the hydration payload built by ADR-0048 (one seed store) and snapshotted by ADR-0011 / ADR-0035 (warm read ≡ live read; streamed resolutions) is *transported* to the client. Changes no public API and no warm-seed semantics — only the bytes on the wire and the work the browser does to read them.

## Context

The SSR renderer ships the client's boot payload — route, params, mount base, and the warm-seed partitions (`cache`, `cells`, `docs`, `sockets`) — in `window.__SSR__`. Two things about *how* it was shipped made a large payload disproportionately expensive on the critical path. A real media grid measured **5.26 MB to parse / 1.19 MB gzipped** embedded, against **2.23 MB / 540 KB** for the same data fetched raw — a 2.35× blowup, plus a main-thread cost the raw number hides.

**1. It was executable JavaScript.** `stateTag` emitted `<script>window.__SSR__ = {…};</script>` — a multi-MB object literal the engine must **compile and evaluate as a program**. JS source is parsed by the full tokenizer; `JSON.parse` is a restricted grammar engines parse several times faster (the Bynens "cost of parsing JSON" result). Shipping data as code paid the slow parser on every byte, on the main thread.

**2. Each json cache body was double-encoded.** `snapshotEntryFromCache` captured a response as `body: await response.text()` — for a json RPC, a JSON *string*. That string was then nested inside the payload and serialised **again** by the payload's own `JSON.stringify`, so every `"` became `\"`. The client paid it back twice: parse the outer payload, then `JSON.parse(body)` per entry at hydration. This is the entire source of the 2.35× (and, because escaping breaks up the repeated tokens gzip feeds on, ~2.2× *gzipped* too).

Neither is inherent to embedding the seed. A client fetch sidesteps both — but throws away the warm-seed guarantee (zero refetch, zero hydration divergence) that `__SSR__` exists to provide. The fix is to keep embedding and stop paying for the transport.

## Decision

### 1. Ship the payload as inert JSON data (`SSR_SCRIPT_ID`)

`stateTag` now emits `<script type="application/json" id="abide-ssr">{…}</script>` — inert text, never compiled as a program. The deferred client bundle (`startClient` → `readSsrPayload`) reads it with one `JSON.parse(element.textContent)`: the fast grammar, off the parse/paint path (it runs in the bundle, not at document-parse time). `safeJsonForScript` already `<`-escapes every `<`, so an embedded `</script>` can't close the tag early — the one injection concern for a data script.

`readSsrPayload` prefers a pre-set `globalThis.__SSR__` (the `uiStartClient` tests stamp it directly; any pre-bundle inline stamp still wins) and, after parsing the element, **republishes** the payload onto `globalThis.__SSR__` for devtools / inspector visibility. So the global still exists for debugging — it's just populated by the bundle from data, not by an eager compiled statement. Both sides import `SSR_SCRIPT_ID` so the write id and read id can't drift.

### 2. Ship a json body pre-parsed as `data`, single-encoded

`CacheSnapshotEntry`'s body now travels in one of two shapes, never both:

- **json** → parsed, under `data: unknown`. It nests as a live JSON value directly in the payload, so the payload's own `JSON.stringify` encodes it **once**, and the client reads the value straight off the decoded payload — no second parse.
- **text**, or a json body the server couldn't parse → raw, under `body: string` (decoded async client-side exactly as before).

`snapshotEntryFromCache` parses on the json branch and falls back to `body` on a parse failure. The server's own promise-replacement replay (`entry.promise = new Response(body, …)`) still uses the raw string, so nothing on the server side changes. On the client, `cacheEntryFromSnapshot` discriminates on `'data' in entry`: the warm value **is** `entry.data` (routed through the same `bodyValueForKind` mapping, so warm read ≡ live read still holds — ADR-0011), and the replayed `Response` is rebuilt from `JSON.stringify(entry.data)` for any later `.json()`/`.text()`/`.clone()`. Both the inline `__SSR__.cache` partition and the streamed `__abideResolve(…)` chunks get this for free — both flow through `snapshotEntryFromCache`.

## Consequences

- **A large payload is no longer compiled as JS**, and json bodies ship at ~half the bytes (and gzip) with a single parse instead of compile-then-reparse. The buffered top-level-`await` page — the one that felt like a blank pause — pays the most and gains the most.
- **The warm-seed contract is unchanged.** Same partitions, same keys, same zero-refetch/zero-divergence guarantee. This is a transport change; ADR-0048's manifest and ADR-0011's value equivalence are untouched.
- **`window.__SSR__` survives as a debug global**, populated by the deferred bundle rather than an inline statement. Any consumer that read it *synchronously before the bundle ran* would now see it undefined — but no in-tree code did (the pre-bundle seed scripts write `__abideSeeds` / `__abideResolve`, never `__SSR__`). A tool that wants it earlier can read the `abide-ssr` element directly.
- **Response-body byte-fidelity is not preserved for json** — a re-stringified `data` is compact JSON, which may differ in whitespace from the origin body. The decoded *value* is identical (and `json()` emits compact JSON anyway), so only a reader asserting on exact body bytes is affected — a pathological dependency for a cache warm-seed.
- **Not addressed here:** over-fetching at the app level (an RPC that returns far more than SSR renders still seeds all of it) and moving a buffered read off the critical path (top-level `await` vs a streaming `{#await}` read). Those are app-side levers, orthogonal to this transport change.
