# Handoff brief — implement ADR-0024

**Spec (read first, it is the contract):** `docs/adr/0024-ssr-auto-streaming-bare-reads.md`
**Also read:** `CLAUDE.md`, ADR-0019 (the async-cell + SSR-tier model; its v2 follow-up section is this ADR's seed), and `createUiPageRenderer.ts` end to end.

## Goal

Make a bare async read stream its value into the initial HTML with no `{#await}`: the server triggers the read, keeps the stream open, and drains the resolution as it settles — bounded by a deadline that fails closed to today's client-refetch. Reuse the entire existing await-drain path; the only new server behavior is triggering bare reads + the deadline, plus one runtime `markLifecycle`.

## Hard rules
- **NEVER run git.** The orchestrator owns all git.
- biome ignores `src/lib` — hand-style there; `bun run format` outside `src/lib`.
- **Fail closed.** A triggered read that doesn't settle by the deadline MUST ship the `{ key, miss }` marker and let the client refetch — never hold the connection open unbounded. A page with no async reads MUST stay buffered exactly as today.
- Do not regress the Tier-2 blocking barrier or Tier-3 `{#await}` streaming — they must behave identically.

## Sequencing
1. **Discovery** — confirm the trigger seam. On the server, a bare read is peek-only (`cache.ts:903`). Find where a bare read is lowered/executed during SSR and whether a "trigger the smart read" call exists server-side (the client read is "trigger + peek"; ADR-0019 D describes the client path). Determine the minimal way to make the server *trigger* a bare read so its cache entry becomes pending. **Write a findings note** (`docs/handoffs/adr-0024-trigger-findings.md`) before editing — do not guess the trigger mechanism.
2. **D3 first (smallest, independently correct)** — `seedStreamedResolution.ts:30`: add `store.markLifecycle(resolution.key)` after the `entries.set(...)`. Add a test that a streamed resolution wakes a subscribed peek.
3. **D1 + D2 together** — the trigger + the gate.

---

## D1 + D2 — trigger bare reads, open the gate, bound with a deadline

**Files**
- `packages/abide/src/lib/server/runtime/createUiPageRenderer.ts`
  - The gate at `:205` (`if (ssr.awaits.length === 0)`) → also take the streaming branch when any triggered bare read is pending at render-return. The streaming branch (`:251-274`) already drains every shippable pending entry via `streamCacheResolutions` → `resolveChunk` (`:43`), so it needs no change beyond being *entered*.
  - Add the per-render **deadline**: the drain must not await a read forever. When the deadline elapses, ship remaining pending entries as `{ key, miss }` (the existing unshippable path → client refetch) and close the stream.
- The bare-read **trigger** — per discovery. It must fire *outside* the Tier-2 `Promise.all` gather (a triggered bare read streams after the shell; joining the Tier-2 barrier would reintroduce the waterfall Tier-2 avoids). Confirm the ordering explicitly.
- `packages/abide/src/lib/ui/seedStreamedResolution.ts` — D3's `markLifecycle` (see sequencing).

**Watch:**
- `snapshotShippable` (`:6`) already decides which entries can ship inline vs. `{ key, miss }`; reuse it, do not add a parallel notion.
- Stream cells (`NamedAsyncIterable`) must NOT be triggered/awaited — they render `peek()` at flush (unbounded). Only point reads (promise/rpc cells) auto-stream. Assert a stream cell still ships buffered.
- Keys already inlined in `__SSR__` (the `inlinedKeys` set, `:200`) must stay skipped so a value isn't double-shipped.

## Done criteria
- `bun run typecheck` → 0; `bun run test` → green.
- **New tests** (mirror `ssrAsyncCell.test.ts` / `uiRenderToStream.test.ts`):
  - A page with a bare `{user}` read (no `{#await}`) now **streams** the value into the response (shell first, then a `__abideResolve(…)` chunk) and the client adopts it without a refetch. Assert `main` ships it buffered (`undefined`) and this streams it.
  - The **deadline** fires: a bare read that never settles ships a `{ key, miss }` marker and the stream closes — no hang.
  - A page with **no** async reads still returns a buffered `Response` (the `awaits.length === 0` fast path is preserved when nothing is pending).
  - A **stream cell** still renders `peek()` at flush and ships buffered (not triggered).
  - Tier-2 (`computed(await …)`) and Tier-3 (`{#await}`) render byte-identically to `main`.
- **Verify by driving a real render**: serve a page with a slow bare read against a real server, confirm the shell paints immediately and the value streams in (curl the streamed response, or drive the app), and confirm a page with no async reads still ships a single buffered body.
