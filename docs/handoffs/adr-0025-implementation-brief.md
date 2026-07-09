# Handoff brief — implement ADR-0025

**Spec (read first, it is the contract):** `docs/adr/0025-warm-server-graph-checker-for-build-transforms.md`
**Also read:** `CLAUDE.md`, ADR-0022 (the D1 principle this applies + the client transform it complements), ADR-0019/0010 (the warm per-root *shadow* program this mirrors — copy its lifecycle + fail-open discipline), ADR-0017 (the guard, which this must not touch).

## Goal

Give the resolver plugin a warm per-root TS program so the rpc/socket transforms resolve values through the type graph instead of hand-rolled source-text scanners — killing the wrapper-indirection blind spot in streaming detection first, then retiring `OUTBOX_OPT`/`STREAM_HELPERS`/`RPC_EXPORT`/the tokenizers. Fail open to today's scanners throughout.

## Hard rules
- **NEVER run git.** The orchestrator owns all git.
- biome ignores `src/lib` — hand-style there; `bun run format` outside `src/lib`.
- **Fail open is non-negotiable.** No warm program / unresolvable node / checker throw → today's regex/scan path. Never a hard checker dependence; never a build broken by a type-resolution hiccup. If you can't guarantee it, STOP and report.
- **Do NOT touch the side-crossing guard** (ADR-0017/0022-D3, post-DCE metafile in `build.onEnd`). This ADR changes how a transform *reads a value*, not what may reach the client.
- Do not text-extract as a "temporary" step — that is the anti-pattern being removed.

## Sequencing
1. **Discovery + spike FIRST — this ADR does not ship until the program build is proven cheap and correct.** Do not write transform changes before this lands.
   - Spike: in the resolver plugin, build a `ts.Program` (or reuse `createShadowProgram`'s pattern) scoped to a real rpc module + its transitive imports for a kitchen-sink endpoint, and query the **handler's return type** — confirm you can distinguish a `jsonl()`/`sse()`-returning handler (streaming) from a plain one, *including via a wrapper function* (the case `detectStreaming` misses today).
   - Measure the added cold-build latency on kitchen-sink.
   - **Findings note** (`docs/handoffs/adr-0025-program-findings.md`): does a targeted program suffice for return-type inference? what's the latency? program vs. language service? If the program is too expensive or can't infer the return type from a targeted graph, STOP and report — the ADR names gating the warm program to only the transforms that need it (streaming) as the fallback.
2. **D2 streaming detection** (the one with a real correctness gap) — implement first, prove the wrapper case.
3. **D2 `outbox` / method / tokenizer retirement** — only if the program cost is justified for these conveniences; otherwise leave them on the scan (the ADR permits this).

---

## D1 + D2 — warm program, type queries, fail-open

**Files**
- `packages/abide/src/abideResolverPlugin.ts`
  - Add a warm per-root program cache (mirror `interpolationClassifierForRoot`'s `Map<root, program | undefined>` + lazy build + fail-open-to-undefined). The rpc `onLoad` (`:385`, calls `prepareRpcModule` at `:393`) and the sockets `onLoad` (`:438`) are the consumers.
- `packages/abide/src/lib/shared/prepareRpcModule.ts`
  - `detectStreaming` (`:164`) + `STREAM_HELPERS` (`:154`): replace the char-scan with a return-type query when the program is available; fall back to the scan otherwise. This is the headline change — it fixes the wrapper-indirection blind spot the current comment admits.
  - `detectDurable` (`:128`) + `OUTBOX_OPT` (`:28`): resolve the `outbox` property's literal type when available; keep the regex as fallback + the mutating-only/literal validation (which ADR-0022 D2 already reduced it to).
  - `splitTopLevelArgs` (`:198`) / `lastArgText` (`:230`): shrink to `CallExpression.arguments` access where a program node is in hand; keep the tokenizer only for the residual raw-span step.
- `packages/abide/src/lib/shared/detectRpcMethod.ts` (`RPC_EXPORT` `:13`) + `writeRpcDts.ts` — resolve the method from the export's declared helper type when available; regex fallback.
- `findExportCallSite.ts` / `skipNonCode.ts` — reduce to the residual span-finding role; do not delete `skipNonCode` unless every one of its 14 references is genuinely gone.

**Threading:** the program (or a small `serverTypeResolver` closure over it) passes into `prepareRpcModule` as an **optional** argument — absent ⇒ every query fails open to the existing scan, so no non-warm call site changes.

## Done criteria
- `bun run typecheck` → 0; `bun run test` → green.
- **New tests:**
  - Streaming detected through a **wrapper function** (handler returns `makeStream()` where `makeStream` returns `jsonl(...)`) — assert `main` misclassifies it non-streaming and this classifies it streaming.
  - **Fail-open:** with no warm program, `prepareRpcModule` produces byte-identical output to today for the existing `prepareRpcModulePolicy.test.ts` cases.
  - `outbox`/method type-resolution paths (if implemented) covered, each with its fail-open fallback.
- **Verify by driving a real build:** `abide build` kitchen-sink; confirm a wrapper-returning streaming rpc now emits the streaming client stub (`{ streaming: true }`) where `main` did not — grep the emitted client module.
- Measured cold-build delta recorded in the findings note; if material, the warm program is gated per the ADR's budget open-question.
