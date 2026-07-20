# Streaming SSR (out-of-order flush) — staged plan

Implements TODO #12 (rpc-core §5.4 / §6 / §7.4): move server render from "single awaited string"
to **shell + out-of-order patch stream**, with progressive hydration and a continuous `{#for await}`
stream handoff. This is a rewrite of the two most bug-prone areas — the emit byte-parity oracle
(`ui/internal/emit*`) and the Stage-2 hydration cursor (`runtime.ts`/`bootstrap.ts`). Ship as staged
PRs, **each gated on the full pipeline** (`bun test` + tsc + lint + `abide check packages/docs` +
docs Playwright e2e — the real gate; abide `bun test` green ≠ framework works).

## Decisions (grill, locked)

1. **Streaming is the DEFAULT and ONLY render path.** The buffered-string path is removed — but the
   real-500 guarantee (TODO #7) is preserved structurally, not by a separate mode: render/drain
   **eagerly**, and only *commit* to a streamed `200` when a read actually blocks past the deadline (or
   a suspense boundary is hit). A page whose reads are all already resolved (warm cache — the common
   case) produces the whole document **before the first flush**, so a render error before first flush
   still returns a controlled `500`. After the shell flushes, a later error becomes an error-patch +
   stream abort (PR4).
2. **Deadline-based auto-boundaries, no new author syntax.** Every `{await fn()}` / `{#await}` is an
   implicit boundary, but only a read still *pending* when its component runs emits a placeholder;
   already-resolved reads render inline exactly as today. Rendering continues with siblings past a
   placeholder — a pending read blocks **only its direct dependents, never siblings**.
1b. **Soft-nav STREAMS too (grill 2).** In-app navigation is not an exception — a slow read on a
   soft-nav shows the shell + streams in, same as first load. This changes soft-nav's transport from a
   buffered JSON `{html, seed}` envelope to a **streamed body** (shell + patches + seed-tail), consumed
   by a client stream-reader (PR4) — because a `fetch`ed body's inline `<script>`s do NOT auto-run
   (unlike the browser-parsed first-load document), so the client applies patches programmatically via
   the shared applicator. The 4ms deadline is a per-read ceiling only "spent" on a genuinely-pending
   read — a fast read resolves and the render continues immediately (no flat tax); the per-render
   deadline timer is created eagerly but unref'd and never awaited unless a read races it (lazy-timer
   micro-opt declined).
3. **Patch wire format + shared envelope/applicator.** Each resolved pending subtree streams a
   `<template id="ab-p:N">…patch html…</template>` + a tiny inline `<script>` that moves it into the
   placeholder **and** an adjacent `<script type="application/json">` seed piece for that subtree's
   reads. Patches land **pre-hydration** (visible without the main bundle) and give hydration an
   already-complete DOM to claim. Built on ONE extracted primitive — the **subtree envelope**
   `{ target?, html, reads }` + client **applicator** `applyEnvelope(targetNode, html, reads)` (swap
   html → replay reads → hydrate/claim). Soft-nav (`navigate.ts`) already *is* this (`{html, seed,
   url}` → `innerHTML` swap → `mountPathname(seed)`); PR1 extracts it as the shared function. **HMR
   reuse (follow-up, enabled not scoped):** dev live-reload can drop `location.reload()` (`serve.ts`)
   for a targeted `applyEnvelope` subtree patch on **markup/data** changes, keeping a small "did the JS
   graph change? → reload : patch" gate for bundle changes.
4. **Suspense streaming first, continuous handoff second.** PR1–4 = `{await}`/`{#await}` suspense
   streaming (§5.4). PR5–6 = `{#for await}` continuous stream handoff (§6, the LLM-token/agent case;
   client-side already works as a create-fallback).
5. **Server flush = promise-join, not a server signal graph.** A pending subtree awaits `Promise.all`
   of its own pending reads, then renders + flushes its patch; siblings flush independently. Satisfies
   "blocks only direct dependents, never siblings" and "re-check until all ready" (§7.4) without
   porting the client signal graph to the server.

## Current model (what changes)

- `ui/internal/emitServer.ts` emits `async render($scope)` returning one buffered `$out`; every read is
  `await`ed inline; control-flow blocks are nested async IIFEs each returning their own `$out`.
- `server/internal/pages.ts`: `renderLevel` awaits the whole string; `collectSeed` snapshots resolved
  slots into ONE bottom `#__abide-seed` blob; `renderDocument` wraps it.
- `server/internal/router.ts`: `new Response(htmlString)` for full-doc; `json({html, seed, url})` for
  soft-nav.
- `ui/navigate.ts`: soft-nav applicator (innerHTML swap → `mountPathname(seed)` → hydrate).

## Staged PRs

### PR1 — Streaming transport + shell/tail seam (buffered-equivalent)
Router serves the SSR document via `new Response(ReadableStream)` instead of `Response(string)`.
`renderDocument` is refactored into a `documentFrame(opts) → { head, tail }` seam (head = everything
through `<div id="__abide-app">`; tail = the seed script + client script + `</div></body></html>`),
and `renderDocument` stays **byte-identical** (`head + inner + tail`). `streamDocument(inner, opts)`
enqueues head/inner/tail as chunks and closes — same bytes on the wire, and the 500 guarantee is intact
because `renderPage` + `collectSeed` are still fully awaited **before** the Response is constructed (an
error throws into the router's catch → controlled 500). This proves `Response(ReadableStream)`
end-to-end under `Bun.serve` and gives PR2 the flush seam. The shared envelope/applicator extraction
moves to PR2, where the patch protocol defines its interface. **Gate:** 92 e2e + emit oracle
byte-identical.

### PR2 — Suspense placeholders + out-of-order flush ✅ LANDED
The FULL `{#await}{:then}` block is the streaming form (an `inline` flag threaded parse → plan → emit
distinguishes it from the blocking inline shorthand `{#await p then v}`, which desugars to the same
shape). `emitServer` lowers it to `$rt.awaitStream({read, resolved, pending, caught, finalize})`
(`ui/internal/streamScope.ts`): the read is raced against ONE per-render deadline; settle-in-time →
render the resolved branch **inline** (byte-identical to the blocking path); still pending → emit an
`<abide-slot id="ab-p:N">`+pending-fallback now and register a deferred subtree. `streamPageDocument`
flushes `head → shell → out-of-order patches → seed+tail`: each deferred (`drainPatches`, promise-join)
streams a `<template data-ab-patch="N">`+move-script patch as it resolves; the seed is collected AFTER
the drain (so streamed reads are included — one tail seed for now). No stream scope (direct `render()`
in tests) → awaits fully inline, so the oracle + all buffered tests stay byte-identical.
**Deadline is time-based (default 4ms, `ABIDE_SSR_DEADLINE`), NOT a macrotask:** empirically an SSR
read is always cold-cache and crosses ≥1 macrotask, and the deadline timer is scheduled before the
read kicks, so a `setTimeout(0)` deadline fired first and streamed EVERY read. 4ms cleanly separates a
cold-but-fast in-proc read (~0.1ms → inline) from genuine I/O (ms+ → stream) with wide margin, so the
classification is stable across machines. **Deferred to PR3** (the client can't yet reactively claim a
streamed subtree — the move-script fills it pre-hydration, but the shared `applyEnvelope` + soft-nav
migration needs the patch/claim protocol): the `{target?, html, reads}` envelope + applicator.
**Verified:** 2 integration tests (fast→inline no-slot, slow→out-of-order patch+move-script+ordering) +
907 unit + tsc + lint + `abide check packages/docs` + docs e2e (92). Refs: `ui/internal/streamScope.ts`
(new), `ui/internal/emitServer.ts`, `ui/internal/{ast,parse,templatePlan}.ts` (`inline`),
`shared/internal/context.ts` (`StreamScope`), `server/internal/{pages,router}.ts`, `server/pages.test.ts`.

### PR3 — First-load progressive hydration (client CLAIMS streamed subtrees) ✅ LANDED
Decision (a) **unwrap**: `runtime.awaitBlock`'s hydrate path calls `unwrapStreamSlot(parent, open)`
first — if the node after the block's `open` anchor is a streamed `<abide-slot>` (its patch filled it;
module-deferred hydration runs after every patch + the tail seed, so on first load it always has), it
lifts the resolved branch out to sit DIRECTLY between the anchors and drops the wrapper. The existing
`claimAwait` then runs byte-for-byte as for a non-streamed block: the tail seed primed the read, so it
peeks settled and CLAIMS the streamed branch (no re-create, no refetch). After hydration a streamed
block is indistinguishable from an inline one → every reactive-swap/teardown path stays
single-codepath. **Key simplifier confirmed:** the client bundle is a deferred module script, so at
hydrate time every slot is filled + the seed complete — no hydration-vs-patch race. The `<abide-slot>`
carries an inline `style="display:contents"` (no global stylesheet / head-byte change) so it is
layout-transparent during the streaming window. **Deferred to PR4** (needs the client stream-consumer):
the shared `{target?,html,reads}` envelope + `applyEnvelope` extraction. **Verified:** a real-browser
hydration e2e (`/streaming` sample + `streamSlow` 40ms RPC) — asserts the raw HTML streamed (placeholder
+ out-of-order patch), the value is present after load, the `<abide-slot>` is UNWRAPPED (0 in the live
DOM), the claimed block stays reactive (refresh advances the run counter), and NO hydration-mismatch
warning fired — plus 907 unit + tsc + lint + `abide check` + docs e2e (93, every existing await page
still hydrates). Refs: `ui/internal/runtime.ts` (`unwrapStreamSlot`), `ui/internal/streamScope.ts`
(slot style), `docs`: `ui/pages/streaming/page.abide`, `server/rpc/streamSlow.ts`, `e2e/streaming.spec.ts`.

### PR4 — Streaming soft-nav (true incremental) ✅ LANDED
Decision (2) TRUE INCREMENTAL. Soft-nav's response is now a **JSONL frame stream** (not the buffered
JSON `{html, seed}` envelope): `{kind:"shell", html, url}` first, then `{kind:"patch", id, html}` per
streamed subtree as it resolves, then `{kind:"seed", seed}` last (`server/internal/pages.ts
streamSoftNav`, `content-type: application/jsonl`). `navigate.ts softLoad` reads the frames
PROGRESSIVELY (`readFrames` — decode + split on `\n`, parse each line as it completes): swaps the shell
into `#__abide-app` immediately (a slow read shows its `<abide-slot>` fallback), fills each placeholder
as its patch frame arrives (`fillSlot` — a `<template>`.innerHTML parse + `replaceChildren`, i.e. the
same DOM op the first-load move-script does but in JS, since a `fetch`ed body's inline scripts don't
auto-run), then once the stream ends hydrates the assembled DOM (the SAME `mountPathname` path — PR3
unwraps the slots). Disposes the previous mount BEFORE the shell swap (dispose-first invariant). A
middleware short-circuit still arrives as a JSON `{redirect}` envelope (checked before the stream —
`jsonl` is matched BEFORE `json` since the former contains the latter as a substring). JSONL is the
framing (robustly newline-delimited + JSON-escaped so HTML can't break it + carries url/id/seed). One
tail seed for now (per-patch seed pieces = a later refinement; hydration is single-pass at stream end,
so it needs only the complete seed). **Verified:** a progressive soft-nav e2e (nav to `/streaming`
shows `pending` then the streamed value, marker survives = no full reload, `<abide-slot>` unwrapped,
reactive after nav) + the server-side soft-nav tests migrated to a `parseSoftNav` JSONL helper + 907
unit (4 deterministic runs) + tsc + lint + `abide check` + docs e2e (94, every existing soft-nav page
green). **Contamination fix en route:** the migrated soft-nav tests were throwing on `response.json()`
of a JSONL body BEFORE `app.stop()`, leaking apps/timers that intermittently broke happy-dom
(`document is not defined`) in other files — fixing them to `parseSoftNav` restored determinism. Refs:
`server/internal/{pages,router}.ts`, `ui/navigate.ts` (`readFrames`/`fillSlot`/`softLoad`),
`ui/internal/streamScope.ts` (`Patch`/`documentPatch`), `test/parseSoftNav.ts`, `ui/nav.test.ts`;
docs `e2e/streaming.spec.ts`.

### PR5 — Error/status semantics ✅ LANDED
Three error paths, all verified:
- **Before first flush → controlled 500** (preserves TODO #7): a streaming `{#await}` whose read
  settles (rejects) within the deadline renders inline; with no `{:catch}` that rethrows out of
  `renderPage` before the shell flushes → the router's catch returns a 500 — same as a blocking read.
- **Streamed error WITH `{:catch}` → the catch branch streams as the patch** (the graceful path):
  `settle()` renders `{:catch}` when the read rejects, so a slow rejecting read streams its catch
  branch exactly like a resolved subtree; the client hydrates it. Note the server-vs-client view
  divergence (correct + secure): server-side the catch sees the RAW error; on the wire an uncaught
  handler throw is a 500 with no raw message, and an errored read carries no seed, so the client
  re-fetches and its `{:catch}` renders the resulting `HttpError` ("Internal Server Error").
- **Streamed error with NO `{:catch}` → an empty patch CLEARS the slot** (can't 500 post-flush) + a
  loud server log. Deliberately NOT a stream abort — aborting would kill sibling patches + the rest of
  the page for one failed subtree; a bounded, logged, empty subtree is the graceful degradation
  (authors add `{:catch}` for real error UI).
`ABIDE_SSR_DEADLINE` shipped in PR2. **Verified:** 3 integration tests (before-flush 500, streamed
catch patch, cleared-slot) + a browser e2e (streamed `{:catch}` renders the client HTTP-error view,
slots unwrapped) + 910 unit (2 deterministic runs) + tsc + lint + `abide check` + docs e2e (95). Refs:
`ui/internal/streamScope.ts` (deferred error → empty-patch + log), `server/pages.test.ts`; docs
`server/rpc/streamBoom.ts`, `ui/pages/streaming/page.abide`, `e2e/streaming.spec.ts`.

### PR6 — Continuous `{#for await}` SSR handoff — server ✅ LANDED
The emitter lowers a `{#for await}` to `$rt.forAwaitStream({source, renderItem, caught})`
(`streamScope.ts`): it drains the source up to the deadline INLINE (a synchronous/fast stream stays
byte-identical to the buffered full-drain — proven by the oracle's `for await` fixtures via the
no-stream-scope path), then returns an `<abide-list id="ab-l:N" style="display:contents">` with the
items seen so far and registers a **streamer** (a multi-yield deferred, `DeferredStreamer`). The
scheduler generalized: `drainPatches` now interleaves single-resolve subtrees (`fill`) with streamers
that yield many `append`s then a `complete` (out-of-order, keyed `s`/`l`). Each item streams as an
`append` patch (`<template data-ab-append>` + `$abideAppend` into the list) as the source yields it;
when the source **ends within the budget** (`ABIDE_SSR_STREAM_BUDGET`, default 30s) a `complete` patch
flags the list `data-ab-done` (the client will CLAIM it — PR7); if it **exceeds** the budget it is cut
off WITHOUT the flag (client re-iterates) — so an SSR `{#for await}` NEVER hangs the body. `{:catch}`
appends the catch branch then completes. The `done(source)` probe flips when the streamer finishes.
Works for any source (local generator / RPC / socket) — HTML is streamed, no value serialization.
**Verified:** a server integration test (a slow generator streams `append` patches then `$abideDone`) +
the existing `{#for await}` e2e green (client still re-iterates over the streamed list — a safe state)
+ 911 unit + tsc + lint + `abide check` + docs e2e (95). Refs: `ui/internal/streamScope.ts`
(`forAwaitStream`/`DeferredStreamer`/generalized `drainPatches`/`Patch` union), `ui/internal/emitServer.ts`,
`shared/internal/context.ts` (`streamBudget`/`streamers`/`StreamFrame`), `server/internal/pages.ts`.

### PR7 — Continuous handoff — client claim / attach → SUPERSEDED by `replayable-streams.md`
The naive versions here were shown unsound (a "static claim" leaves item-body `onclick`/state dead) or
incomplete (attaching to the document body only works while it stays open; the real concern is the
client RE-RUNNING an expensive stream — double-billing a model call — and sharing one run across
refreshers). The sound design is an **authoritative `ReplayableStream`** (consume-once + buffer +
replay-then-live fan-out, keyed `(fn,args)`): the client ATTACHES to the slot (replay + subscribe,
reactive item mount) instead of re-running, cross-request refreshers share one run, and the SSR seed
carries a slot handle, not a re-runnable source. See `docs/spec/replayable-streams.md` (design of
record; not yet built). PR1–6 (per-request SSR streaming) are the shipped substrate underneath.

## Follow-ups (enabled, not scoped here)
- **HMR onto `applyEnvelope`** (decision 3): dev reload hot-swaps a changed subtree for markup/data
  changes; JS-graph changes still reload.
- Fine-grained streaming hydration of nested-within-nested suspense (PR3 handles one level of claim per
  patch; deeply nested pending-within-pending is claimed as its patch lands).

## Deferred / parked
- HTTP/1.1 vs H2 multiplexing of patches (transport-agnostic; patches ride the one response body).
- Backpressure tuning of the patch stream under many concurrent slow reads.
</content>
</invoke>
