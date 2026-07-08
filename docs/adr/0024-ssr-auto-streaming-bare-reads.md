# ADR-0024: SSR auto-streaming for bare async reads

**Status:** proposed (2026-07-08). Promotes the "Optional follow-up (v2 —
auto-streaming bare reads)" section of
[ADR-0019](0019-async-computeds-and-rpc-auto-reads.md) into a decided change, now
that the async-cell probe lifecycle, the SSR tier model, and the streamed-cache
drain all landed. Shares the fail-closed / high-visibility instinct: a bare read
that can't stream degrades to today's client-fetch, never a hang.

## Context

A **bare async read** — `{user}`, `computed(getUser())` with no `{#await}` — is
Tier-1 today (ADR-0019 SSR table): the server renders `undefined` and ships the shell
**buffered**; the client refetches on hydrate and re-renders on settle. Streaming a
bare read's value into the initial HTML requires wrapping it in `{#await}` (Tier 3).

The buffered/streamed fork is one gate — `createUiPageRenderer.ts:205`:

```ts
if (ssr.awaits.length === 0) { /* build shell, hard-return a buffered Response */ }
```

Only a streaming `{#await}` block pushes `ssr.awaits`, so with none the response is fully
buffered and returned before any async settle.

**Everything downstream of that gate already exists.** The streaming branch
(`createUiPageRenderer.ts:251-274`) drains late-settling cache entries after the shell
flushes — `streamCacheResolutions` → `resolveChunk` (`:43`) → an inline `__abideResolve(…)`
chunk (`CACHE_RESOLVE_SCRIPT`, `:37`), skipping keys already inlined; `snapshotShippable`
(`:6`) gates which entries ship. The bundle-consumed counterpart (`applyResolved.ts`, the
`<abide-cache>` frame branch) and `seedStreamedResolution` warm the streamed partition. So
the client can already *adopt* a streamed resolution — nothing on the server produces one
for a bare read.

ADR-0019 named two changes to light this up. Investigation for this ADR surfaces a **third,
load-bearing** one they glossed:

- **The server does not trigger a bare read** — it is `peek`-only, non-triggering (ADR-0019
  D, and `cache.ts:903` "synchronous, non-triggering value probe"). No trigger → no pending
  entry is ever created on the server → the drain loop has nothing to stream. So
  auto-streaming is not "keep the connection open and drain"; it first requires the server
  to *trigger* bare reads so entries become pending and settle mid-stream. That is an
  SSR-tier semantic change, not a gate flip — which is why this is an ADR, not a patch.

## Decision

### D1 — a streaming-capable render triggers bare reads and keeps the stream open until they settle

In a streaming-capable page render, a bare async read **triggers its fetch** at render (like
the await path), the render returns a shell immediately, and the response stream stays open,
draining each read's resolution as it settles — exactly the existing await-drain machinery,
now fed by triggered bare reads. A bare read thus moves from Tier-1 (client-fetched) to a
new **Tier-1-streamed** tier: server-triggered, streamed-in, no client refetch.

- **Stream cells stay `peek()`-at-flush** (ADR-0019: you can't block/stream an unbounded
  stream on an SSR barrier). Only point reads (promise/rpc cells) auto-stream.
- **Bounded, fail-closed.** A triggered read that has not settled by a per-render deadline
  ships its `{ key, miss }` marker (the existing unshippable path) and the client refetches
  on hydrate — degrading to today's Tier-1 behavior, never holding the connection open
  indefinitely. The deadline is the safety valve the always-buffered model didn't need.

### D2 — the buffered/streamed gate also opens on a pending triggered read

`createUiPageRenderer.ts:205` takes the streaming path when `ssr.awaits.length > 0` **or**
any triggered bare read is pending at render-return. The streaming branch is otherwise
unchanged — `streamCacheResolutions` already drains every shippable pending entry, not only
await-block ones.

### D3 — the streamed seed fires a lifecycle wake

`seedStreamedResolution` (`seedStreamedResolution.ts:30`) does a bare `entries.set(...)` with
no lifecycle dispatch — it relies on seed-before-mount ordering, valid for the await path. A
bare read subscribed to the lifecycle channel needs the wake, so it fires
`store.markLifecycle(resolution.key)` after the set, waking the subscribed peek to re-render.
(This is the ADR-0019 v2 change #2, verified still outstanding.)

## Consequences

- **Bare reads stream by default, no `{#await}` required** — the ergonomic win: warm HTML
  without ceremony, and the client adopts the streamed branch instead of refetching.
- **TTFB tradeoff — must be conscious.** A page with a slow bare read now holds the response
  stream (shell flushes first, so TTFB to first paint is unchanged; time-to-complete grows).
  The D1 deadline bounds it. A page with no async reads is unaffected (buffered, as today).
- **The SSR tier table changes:** the bare-read row moves from "renders `undefined`, ships
  buffered, client refetches" to "server-triggers, streams in, no refetch." ADR-0019's Tier
  table and the AGENTS surface note update.
- **Reuses all existing streaming machinery** — `streamCacheResolutions` / `resolveChunk` /
  `CACHE_RESOLVE_SCRIPT` / `seedStreamedResolution` / `applyResolved`. The only new server
  behavior is triggering bare reads + the deadline; the only runtime edit is D3's
  `markLifecycle`.
- **Lights up `applyResolved.ts`'s `<abide-cache>` producer gap** — ADR-0019 flagged it as a
  consumer with no producer; the bundle-consumed streaming path (SPA nav / socket-delivered
  SSR) gains its producer here too.

## Open questions

- **The deadline: fixed, per-page, or per-read?** Leaning a single per-render deadline
  (simple, one knob) with a possible endpoint-policy override later (ADR-0020's `cache`
  namespace is the natural home). A per-read opt-out (`{#await}` remains the explicit
  "stream this one") stays available.
- **Interaction with the blocking Tier-2 barrier** (top-level `await` / `computed(await …)`,
  ADR-0019). Tier-2 awaits `allSettled` inline before flush; a triggered bare read must NOT
  join that barrier (it would reintroduce the waterfall Tier-2's `Promise.all` avoids) — it
  streams *after* the shell. Confirm the trigger fires outside the Tier-2 gather.
- **Should auto-trigger be default-on, or opt-in?** Leaning default-on for point reads (it is
  the DX the ADR-0019 model promised) with the deadline as the fail-closed backstop; a strict
  flag to force buffered stays open.
