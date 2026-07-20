# Stage 2 implementation plan — true C2 attach-hydration

Concrete plan for Stage 2 (`#2` hydration) on top of the complete Stage 1 AOT emitter. Companion to
`attach-hydration-design.md` and `attach-hydration-stage1-plan.md`. Every `file:line` is an anchor in
the current tree. Gates per PR: `bun test` (696/0 today) green and `bunx tsc --noEmit` clean.

## 0. Orienting facts
- Emitted client `hydrate($container,$scope)` is a STUB: `$container.textContent=""; return mount(...)`
  (`emitClient.ts:95-99`), exported via `EmittedModule.hydrate` (`emit.ts:26,104,107`) but never
  called — `bootstrap.ts:101` and `navigate.ts:98-102` fresh-mount.
- The shared walk (`templatePlan.ts:253-489`) already emits anchors into `skeletonClient`: `<!---->`
  per interp/html/await leaf (`pushLeaf :259-263`), paired `<!--[--><!--]-->` per block/component.
  **`serverChunks` are anchor-free** (`emitServer.genChunk :108-218`) — the Stage-1-deliberate
  byte-identical choice; changing this is job #1.
- Cursor helpers `template`/`firstChild`/`nextSibling`/`finalize` (`runtime.ts:70-92`) authored
  dual-mode but only clone path used; `$mount${id}` unconditionally clones (`emitClient.ts:132-143`).
- Reactive leaf/block helpers (`interpolate :99`, `awaitText :136`, `htmlBlock :155`, `setAttr :193`,
  `ifBlock :376`, `forBlock :580`, …) CREATE DOM in an `effect()` whose first run writes.
- Seed: `collectSeed` (`pages.ts:95-108`), `HydrationSeed={reads?}` (`pages.ts:86-88`), router bundles
  into document + soft-nav envelope (`router.ts:292,296`), `bootstrap.replayReads :52-62` primes RPC
  cells before mount. State cells (`state.ts:37-45`) re-evaluated client-side, no record/replay.
- Scope injected identically both sides: `{...imports, state, watch, props}` (`pages.ts:73`,
  `bootstrap.ts:98`); `state`/`watch` reach emitted code by import-local off `$scope`
  (`emitSetup.ts:24-28`) — **the injection point for state record/replay; no `ui/state.ts` change.**
- `effect()` runs synchronously on creation (`reactive.ts:275`); `signal.set` no-ops on `===`
  (`reactive.ts:84`).

## 1. Hardest hazard surfaced first: parser text-node merge
The client cursor walk must find the SAME topology in server DOM as in a cloned template. A cloned
`<template>` keeps static and dynamic text as separate `Text` nodes; **the HTML parser merges
adjacent text**. `Hi {name}!` → skeleton `Hi <!---->!` clones to `["Hi ", <!--→, "!"]`; server
`Hi Bob<!---->!` parses to `["Hi Bob", <!--→, "!"]` — static prefix + dynamic value are ONE node.
Resolution (keeps decision 4's single `<!---->`): the interp/await/html slot carries `prefixLen` =
byte length of the immediately-preceding static text (0 if prev sibling is comment/element/none). The
claim splits deterministically:
```
claimText(anchor, prefixLen): Text|null
  p = anchor.previousSibling
  if p is Text and p.length > prefixLen: return prefixLen>0 ? p.splitText(prefixLen) : p
  else return null   // empty value: server emitted no text node; create lazily on first write
```
`splitText` preserves the tail's node identity (no recreate). `prefixLen` added to `pushLeaf`
(`templatePlan.ts:259-263`). Lands in PR3; the browser same-node test must prove it.

## 2. Ordered PR breakdown (each keeps `bun test` green)

> Progress: **PR1 ✅** (server anchors emitted from the shared plan — `<!---->` leaves, paired
> `<!--[-->…<!--]-->` blocks; proven purely additive across all 71 snapshots; 696/0, tsc clean;
> hydration behavior unchanged — client still fresh-mounts, anchors inert).

**PR1 — Server anchors matching the skeleton.** Highest churn, lowest logic risk; first. ✅
- `emitServer.genChunk` (`emitServer.ts:108-218`): emit `<!---->` after interp/html/await; wrap
  if/for/awaitBlock/switch/try/component in `<!--[-->`…`<!--]-->`, driven off the SAME plan (anchors
  match client by construction, decision 3).
- Update `emit.oracle.test.ts.snap` (every dynamic fixture's server string changes),
  `emitCapabilities.test.ts` (has `stripAnchors :20-22`; audit), and interp-wrapping `toContain`s:
  `emitSsr.test.ts:27,40,53`, `pages.test.ts:26,40` (prefer `stripAnchors` helper).
- Hydrate still the clearing stub → anchored HTML + fresh mount stays correct; browser lane green.

> PR2 ✅ (`context.ts`/`scope.ts` gained `states: []`; `renderPage` wraps injected `state` to record
> raw initials in call order; `HydrationSeed.states?` + `collectSeed` append; client `makeSeededState`
> replays by ordinal, re-applying transform; module-before-instance order identical by construction
> via shared `emitInstanceSetup`; non-JSON initials → `null`; 708/0, tsc clean).
>
> **KNOWN LIMITATION (tracked, deferred):** module-level (`<script module>`) *non-deterministic* state
> desyncs under a warmed server — module setup memoizes once per process, so warm renders don't
> re-record its initials and the ordinals misalign vs the client (which runs module setup fresh per
> mount). Instance-level state (decision 10's target) is fully deterministic. Proper fix = decision
> 10's render-lifecycle hook: server caches the cold-render module recordings and always prepends them
> to the seed with a phase boundary; client consumes module-ordinals during `$ensureModule` and
> instance-ordinals during instance setup (needs the emitter to signal the phase transition). Rare
> anti-pattern (process-shared value); suppress-write (PR3) does not worsen it (keeps correct server
> DOM until first update). Do this before Stage 2 is declared production-complete.

**PR2 — State-initializer record/replay** (decision 10; prerequisite for suppress-write). ✅
- `context.ts:15-21`: add `states: unknown[]`. `pages.ts:73`: wrap injected `state` to
  `getContext().states.push(rawInitial)` in call order then delegate. `collectSeed` appends
  `states` when non-empty; extend `HydrationSeed` (`pages.ts:86`) with `states?`.
- `bootstrap.ts:98`: wrap injected `state` with an ordinal counter consuming `seed.states[i]`
  (passing the page's `transform` through), fallback to literal initial when unseeded. No router
  change. **Riskiest: call-order determinism** — fuzz ordinal alignment incl. module+instance order.

> PR3 ✅ (`runtime.ts`: `hydrating` flag + `startHydration/endHydration`, `claimInto` (moves server
> region into a fragment so `nav`/`finalize` run unchanged), `claimText(anchor, prefixLen)` split for
> the text-merge + empty cases; leaf/attr/bind helpers claim + suppress first write; `listen` attaches
> unconditionally; `templatePlan` computes `prefixLen`; emitted `hydrate` = start/`$build0`/end.
> `emitHydrate.test.ts` asserts node IDENTITY (`===`) pre+post update for interp/element/attr. 714/0,
> tsc clean, browser lane green. **Deferred to PR4:** adjacent no-static-prefix leaves (`{a}{b}`)
> desync — the server inserts a value text node the clone skeleton lacks, shifting positional nav;
> needs the stateful hydration cursor PR4 builds anyway. `htmlBlock` claim is best-effort.)

**PR3 — Claim scaffolding, leaves, elements, suppress-write.** Riskiest correctness after PR1. ✅
- `runtime.ts`: module-level `let hydrating` + `startHydration/endHydration`; `claimInto(parent,
  start, anchor)` (move region `[start..anchor)` into a fresh fragment so `nav`/`finalize` run
  unchanged); `claimText` (§1).
- Leaf/attr helpers read `hydrating` at construction (dynamic — same call re-runs in create mode on
  later updates): `interpolate/awaitText/htmlBlock` claim their node + set a `primed` flag so the
  effect's first pass calls `read()` (subscribes) but SKIPS the DOM write; `setAttr/toggleClass/
  setStyleProp` skip first `applyAttribute`; `listen` attaches unconditionally (decision 7); binds
  skip first push-to-DOM but keep the DOM→cell listener.
- `emitClient.genMountFn :132-143`: `$frag = $rt.hydrating ? claimInto(...) : cloneNode`. Real
  `hydrate` = `startHydration(); try { return $build0($container,null,$scope) } finally {
  endHydration() }`. Leaf slots pass `prefixLen`.
- New `emitHydrate.test.ts`: claimed text/element are the SAME Node objects; no write on pass 1
  (spy `Text.data`/`setAttribute`); subsequent signal update mutates the claimed node in place.

> PR4 ✅ (stateful `hydrateCursor` in `runtime.ts` — DFS walk over real server DOM; emitted mount has
> a clone branch (positional, snapshots byte-identical) + a hydrate branch (cursor DFS) feeding the
> same `$n…` vars; block helpers claim their `<!--[-->…<!--]-->` region + insert create-path markers
> for topology parity; adjacent-leaf `{a}{b}` FIXED; per-block create-fallback on mismatch. 721/0, tsc
> clean, browser 2/2, 24 same-node `.toBe` assertions. Honest edges: switch `leading` created-not-
> claimed (parity-correct); try+finally overlapping `$roots` (harmless, guarded); try catch-on-client-
> throw best-effort; component `{children()}` claimed only for emitted/pass-through components; keyed
> for needs dynamic-bounded item bodies.)

**PR4 — Block claim: if/switch/try/component-children/sync-for.** Riskiest breadth. ✅
- Block helpers gain paired-anchor boundaries; emitter passes the OPEN anchor alongside the existing
  close (`emitClient.ts:221-362`). Under `hydrating`: insert internal marker as the create path does
  (post-hydration topology == fresh mount), select branch untracked (seed-primed conditions → same
  branch server rendered), run the selected `BlockFn` in claim mode over `[open.nextSibling..marker)`
  via a module-level `pendingClaimStart` (Svelte `hydrate_node` pattern; alt: thread `$start` param
  — cleaner types, more call sites). Keyed sync-for claims each server item run into a `ListItem`
  (`runtime.ts:540`) without recreating.

> PR5 ✅ (`awaitBlock` rewritten + `claimAwait`/`runAwaitEffect` in `runtime.ts`; server SSR-renders
> the resolved branch, client peeks the expression once untracked — non-thenable ⇒ claim then/finally,
> sync-throw ⇒ claim catch, real thenable ⇒ graceful create-fallback (pending→settle, no corruption);
> also fixed a latent sync-throw crash. `{#for await}` = documented create-fallback (client re-iterates
> a fresh async iterator; no per-item cursor in the seed to skip the SSR-drained prefix). 727/0, tsc
> clean, browser 2/2. No emitter/seed/bootstrap changes — pure runtime-helper PR.)

**PR5 — Async blocks: `{#await}` / async-for.** Riskiest overall. ✅
- Server SSR-awaits the resolved branch; client `awaitBlock :446` mounts pending then swaps → naive
  mismatch. Under `hydrating`, peek whether the read is already settled (seed-primed RPC → `cell.peek`
  has a value) and claim the then/catch branch directly, wiring the promise only for future
  invalidation; if unsettled (no seed), discard + create (pending). Same for async `forBlock
  :585-609`. Depends on PR2 seed.

> PR6 ✅ (`claimElement(node, tag)` tag-check + `requireOpen`/`claimBlock` anchor-check emitted at
> dynamic element/block slots; `HydrationMismatch` caught block-level → `clearBetween` + `inCreateMode`
> recreate (siblings keep identity) or bubbled to whole-page `hydrate` try/catch → `textContent=""` +
> fresh `mount`; recovery runs in ALL envs, warnings dev-gated via `console.warn` (deliberately NOT the
> `log` surface, which would drag `node:async_hooks` into the bundle). 731/0, tsc clean, bundle still
> async_hooks/typescript-free. Documented uncaught-by-design: same-tag wrong-content, wrong-tag on a
> purely-static container — decision-5 cheap-check cost.)

**PR6 — Localized mismatch recovery + guards** (decision 5). ✅
- Emit `if ($rt.hydrating) $rt.assertTag($node, "button")` at dynamic-element slots + anchor-presence
  checks in block helpers. Attributes re-applied never verified. On `HydrationMismatch`, nearest
  block/root catches → remove region's server nodes → re-run the `BlockFn`/`$build` with `hydrating`
  locally false (create) → dev-warn with slot path. Whole-page last resort: `hydrate()` wraps root in
  try/catch → `textContent=""; mount(...)`.

> PR7 ✅ — **STAGE 2 COMPLETE.** `PageEntry` gained `hydrate`; `clientBundle.entrySource` imports+
> registers both `mount`/`hydrate`; `bootstrapPage` calls `hydrate(container, scope)` on initial load
> (no `textContent` clear — attach, not fresh-mount); `softLoad` swaps `envelope.html` then hydrates
> (one hydrate path for first-load + soft-nav, decision 6). Browser lane upgraded to the ATTACH PROOF:
> `btnAfter === serverBtn` (strict same-node identity of the server-rendered node after hydrate) +
> container-never-cleared + server value un-repainted + the claimed node stays interactive — proven in
> a real happy-dom subprocess running the actual built bundle. Soft-nav same-node hydrate covered at
> the unit level (full subprocess nav impractical in-harness). 732/0, tsc clean, browser 2/2.

**PR7 — Wire hydrate + soft-nav unification.** Riskiest integration. ✅
- `pageRegistry.ts:11-15`: add `hydrate: PageMount` to `PageEntry`. `clientBundle.entrySource
  :102-109`: import `{ mount, hydrate }` per page, register both.
- `bootstrap.bootstrapPage :67-103`: stop clearing; call `hydrate(container, scope)` after
  `replayReads`.
- `navigate.softLoad :96-105`: keep `innerHTML = envelope.html` then HYDRATE the swapped DOM (same
  claim walk) instead of fresh mount — one hydrate path for first-load and soft-nav (decision 6).
- Extend `browserBundle.test.ts`: (a) capture `querySelector("button")` before running the bundle,
  assert identical node after hydrate + never `textContent`-cleared (proves attach); (b) existing
  seed-replay test now proves attach not fresh-mount; (c) soft-nav subprocess case: innerHTML swap →
  hydrate → same-node + no refetch.

## 3. Test strategy
- **Node lane (`emitHydrate.test.ts`):** render anchored server HTML into a happy-dom host, capture
  node refs, `hydrate`, assert `claimedNode === capturedNode` (the load-bearing not-recreated check),
  no write on pass 1 (spy), signal update mutates the SAME node. Blocks: same-node per branch/item +
  branch-flip creates fresh. Async: settled-seed claims then, unsettled falls to pending.
- **Seed/state replay:** `emitSsr.test.ts` asserts `seed.states` records a `state(Date.now())`; a
  client unit asserts the wrapped `state` consumes `seed.states[i]` by ordinal; an end-to-end no-jump
  case (non-deterministic init, hydrate, first update doesn't jump).
- **Browser lane:** upgrade the interactive subprocess test to capture the button node pre-bundle and
  assert identity post-hydrate + no `textContent` clear; add a soft-nav subprocess case.

## 4. Deferred (out of scope for Stage 2)
Islands/static-subtree skipping (decision 8; analysis kept, walk still traverses for cursor sync +
recovery); global event delegation + progressive interactivity (decision 7); build-time
normalization guard (decision 5; fold into #11); nested-`<style>` scope (`templatePlan.ts:478-484`,
Stage-1 fast-follow); fully eval-free generated `src/.abide/*.ts` (SSR still uses cached dynamic
import, `emit.ts:76-90`).

## Critical files
`emitClient.ts` · `runtime.ts` · `emitServer.ts` · `server/internal/pages.ts` · `bootstrap.ts` ·
`templatePlan.ts` · `ui/navigate.ts` · `shared/internal/context.ts`.
