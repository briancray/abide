# ADR-0025 program-build findings

Discovery-first spike for the warm server-graph checker. Question the ADR made
load-bearing: **can the resolver plugin cheaply build a correctly-scoped `ts.Program` and
infer the rpc handler's return type — including through a wrapper function — to decide
streaming?** Answer: **yes.** Shipped the streaming-detection change; gated the warm program
to that transform only (outbox/method left on the scan per the ADR budget).

## Return-type inference — viable

A `ts.Program` rooted at the rpc `.ts` files (transitive imports resolved on demand by the
default compiler host, tsconfig options reused for lib/paths/moduleResolution) resolves the
handler's return type precisely. The query:

1. Find the exported `<METHOD>(handler, …)` call (`ts.CallExpression`, callee a bare rpc-helper
   identifier — top-down so a nested `jsonl(` in the body doesn't match first).
2. `getTypeAtLocation(handler)` → first call signature → `getReturnTypeOfSignature` (unwrap one
   `Promise<…>` layer for async handlers).
3. Streaming iff the return type is `TypedResponse<AsyncIterable<…>>` — a `__body` phantom
   property whose type carries `[Symbol.asyncIterator]` (`__@asyncIterator@<n>` in the member
   name). Unions of return branches count if any branch streams.

Spike results on kitchen-sink and the in-repo fixture:

| handler shape | char-scan (`main`) | return-type query |
| --- | --- | --- |
| direct `jsonl(...)` / `sse(...)` in body | streaming | streaming |
| plain `json({...})` | not streaming | not streaming |
| **wrapper: `() => makeStream()` where `makeStream` returns `jsonl(...)`** | **not streaming (BLIND SPOT)** | **streaming (fixed)** |

The wrapper case is the correctness gap the ADR targets and the current `detectStreaming`
comment concedes. The type query closes it. Verified end-to-end: a real `target: 'client'`
build of a wrapper-returning rpc through `abideResolverPlugin` now emits
`__abideRemoteProxy__(..., { streaming: true })`, where the scan-only path would not.

## Build-latency delta — modest, amortized, fail-open

One warm `ts.Program` per root, built lazily on the first rpc transform and reused across
every rpc transform in that build (mirrors the UI shadow's `interpolationClassifierForRoot`
per-root cache). Measured cold build of the program + checker:

- kitchen-sink, rooted at its 31 rpc files: **~0.5–0.6 s once** (~19 ms amortized per rpc;
  720 files pulled transitively). A whole-app program for comparison was ~0.44 s / 1049 files.
- in-repo 3-file fixture: **~0.4 s once**.

So the added cold-build cost is a few hundred ms **per target build** that contains at least
one rpc module (a build with no rpc modules never touches it — the program is built lazily
from the rpc `onLoad`). This is material but bounded and paid once; the correctness gain
(wrapper streaming) justifies it. Every query fails open: no program, unresolvable node, or
checker throw → today's char-scan, byte-identical output.

## Program vs. language service

Reused the one-shot `ts.createProgram` pattern (as the shadow does), not an incremental
language-service overlay. Rationale matches ADR-0010/0019: the incremental LS doesn't expose
the checker publicly, and a one-shot program per build is simplest and correct. The warm cache
is keyed per root and lives in the resolver-plugin `setup` closure, so a dev watch that reuses
the plugin instance keeps the map but a fresh build rebuilds — acceptable for now; an LS
overlay is a later optimization if dev-rebuild latency bites (open question left open).

## Scope shipped — streaming only (gated)

Per the ADR's build-time-budget open question ("streaming detection is the one with a
correctness gap; outbox/method are conveniences the regexes handle adequately, so they can
stay on the scan if the program cost isn't justified"):

- **Shipped:** streaming detection through the warm program's return-type query, threaded into
  `prepareRpcModule` as an optional `streamingOverride?: boolean` (absent ⇒ scan).
- **Left on the scan (deliberately not migrated):** `OUTBOX_OPT`/`detectDurable`,
  `RPC_EXPORT`/`detectRpcMethod`, and the `splitTopLevelArgs`/`lastArgText`/`findExportCallSite`/
  `skipNonCode` tokenizer family. These carry no correctness gap and migrating them would only
  broaden the program's blast radius for no user-visible gain. `skipNonCode`'s 14 references are
  untouched.
- **Side-crossing guard (ADR-0017/0022-D3, post-DCE metafile in `build.onEnd`):** untouched.
