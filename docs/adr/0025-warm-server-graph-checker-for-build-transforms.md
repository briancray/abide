# ADR-0025: A warm server-graph checker for the rpc/socket build transforms

**Status:** proposed (2026-07-08). Extends
[ADR-0022](0022-build-transforms-resolve-through-the-module-graph.md) D1 ("build
transforms resolve through the module graph, never by lifting inline text") from the
UI compile side to the server-transform side, which never got a checker.
Complements [ADR-0019](0019-async-computeds-and-rpc-auto-reads.md)/ADR-0010's warm
per-root *shadow* program with an analogous warm per-root *server* program. Refines
— does not touch — the ADR-0017/0022-D3 side-crossing guard.

## Context

ADR-0022 D1 established the principle and applied it to the UI side (the client rpc
transform stopped text-splicing) and the shadow (`props<T>()` resolves through the real TS
program). The **rpc/socket bundler transforms still recover meaning by scanning source
text**, because the resolver plugin warms *no* TS program (the shadow is UI-only):

- `prepareRpcModule.ts` — `OUTBOX_OPT` regex (`:28`) + `detectDurable` (`:128`) read the
  `outbox` flag from opts *text* and string-compare against `'true'`/`'false'`;
  `detectStreaming` (`:164`) + `STREAM_HELPERS = new Set(['jsonl','sse'])` (`:154`) scan the
  handler body char-by-char for a `jsonl(`/`sse(` call-name to decide the client proxy is
  streaming — the code's own comment concedes an "indirection through a wrapper function
  isn't seen"; `splitTopLevelArgs` (`:198`) / `lastArgText` (`:230`) are hand-rolled
  depth-aware argument tokenizers.
- `detectRpcMethod.ts` — `RPC_EXPORT` regex (`:13`) reads the HTTP method from the export
  text; feeds `writeRpcDts.ts`.
- `findExportCallSite.ts` — a full char-by-char export/call-site scanner; `skipNonCode.ts`
  (the shared string/comment/regex skipper it and the `prepareRpcModule` tokenizers build on)
  has **14 references** across `shared/` — the surface area of the hand-rolled mini-tokenizer.

These are the exact anti-pattern D1 rejects, still live only because the server side has no
checker to ask. The asymmetry is the tell: the UI side asks the type graph; the server side
guesses from bytes.

## Decision

### D1 — warm one TS program over the server module graph, per root, in the resolver plugin

Mirror ADR-0019/0010's warm per-root shadow: build a `ts.Program` (or language service)
scoped to the server module graph once per project root, lazily on first rpc/socket
transform, and reuse it across every transform in that root. The build cost amortizes the way
the shadow's does; a program that can't build yields *undefined* and every consumer fails
open (below).

### D2 — replace the syntactic scanners with type queries

- **Streaming detection → the handler's return type.** Ask whether the handler's return type
  is (or resolves to) a `TypedResponse<AsyncIterable<…>>` / the branded streaming shape,
  instead of scanning for `jsonl(`/`sse(`. This kills `STREAM_HELPERS` *and* the
  wrapper-indirection blind spot the current comment admits — a handler returning a stream
  via a helper function is now seen.
- **`outbox` → the opts property's type.** Resolve the `outbox` property's literal type
  (`true`/`false`) through the checker rather than regex-matching a text token; this also
  lifts the "must be an inline literal" restriction to "must be statically known," and
  ignores an `outbox:` mention inside the handler body.
- **HTTP method → the export's declared helper type.** Resolve `detectRpcMethod` through the
  export binding's type (`GET`/`POST`/…) rather than the `RPC_EXPORT` regex.
- **`findExportCallSite` / `splitTopLevelArgs` / `lastArgText` shrink to AST access** —
  `CallExpression.arguments`, `getStart`/`getEnd` spans — where a program node is in hand.
  `skipNonCode` stays only where a genuine raw-text step remains (locating a span to
  splice), not as the meaning source.

### D3 — fail open to today's scanners; the guard is unaffected

Every replaced query fails open exactly as the UI classifier does (ADR-0019 stage B): no
warm program, or an unresolvable node, or a checker throw → fall back to today's
regex/text-scan path. So this can never break a build; with types it is precise, without them
it is exactly today. The ADR-0017/0022-D3 side-crossing guard is orthogonal (it runs post-DCE
on the metafile) and is not touched — this ADR changes *how a transform reads a value*, not
*what may reach the client*.

## Consequences

- **The hand-rolled server tokenizer family retires** (or shrinks to a residual span-finder):
  `OUTBOX_OPT`, `STREAM_HELPERS`, `detectStreaming`'s char scan, `RPC_EXPORT`,
  `detectDurable`'s string compare, and much of `findExportCallSite` / `splitTopLevelArgs` /
  `lastArgText`.
- **Streaming detection gains correctness** — the wrapper-indirection case (handler returns a
  stream through a helper) is detected, not silently treated as non-streaming.
- **The two build-transform sides finally agree** with ADR-0022 D1: both the UI compile and
  the server transforms resolve through the real program.
- **New infrastructure — the real cost.** A warmed server program per root is heavier than
  the regexes it replaces. Bounded by: per-root reuse (one build, many transforms), fail-open
  (never required), and scoping the program to the rpc/socket module + its transitive imports
  rather than the whole app where feasible.
- **Enables downstream** — a checker in the resolver plugin is also the prerequisite for any
  future "resolve endpoint policy / schema types on the server transform" work, and for
  type-aware query coercion (`parseArgs`'s `TODO(query-coercion)` needs the input schema's
  type structure, which a program could supply).

## Open questions

- **Can the resolver plugin cheaply build a correctly-scoped program?** The load-bearing
  prerequisite. It has the entry paths and tsconfig; the question is latency and whether a
  targeted program over the rpc module + imports suffices to infer the handler's return type
  (it must, without pulling the whole app). Discovery-first in the brief — spike the program
  build + a `getReturnType` query before committing.
- **Program vs. language service.** The shadow uses a one-shot `createShadowProgram` per root
  (the incremental LS doesn't expose the checker publicly). Reuse that pattern, or invest in
  an LS overlay for incremental dev rebuilds? Leaning: reuse the one-shot program first,
  optimize later if dev-rebuild latency bites.
- **Build-time budget.** Quantify the added cold-build cost on kitchen-sink; if material,
  gate the warm program behind the transforms that actually benefit (streaming detection is
  the one with a correctness gap; `outbox`/method are conveniences the regexes handle
  adequately, so they can stay on the scan if the program cost isn't justified for them).
