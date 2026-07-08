# ADR-0022: Build transforms resolve through the module graph, not inline source text

**Status:** proposed (2026-07-08). Supersedes the client-policy mechanism
introduced for [ADR-0020](0020-cache-policy-on-the-endpoint.md) (the
`extractObjectProperty` text-splice) and refines — does not broaden — the
side-crossing guard from
[ADR-0017](0017-side-crossing-guard-stays-inside-the-resolver-plugin.md): the one
client-reaches-server edge becomes reachability-based rather than
presence-at-resolve, with no new edges. The guard *stays in the resolver plugin*
(0017 holds). Touches the shadow from
[ADR-0010](0010-template-type-checking-via-virtual-shadow.md).

## Context

Two independent papercuts, one root cause.

1. **Client cache/stream policy (ADR-0020) is lifted as source text.** The client
   `onLoad` replaces the whole `$rpc/**` module with a fresh proxy stub and splices
   the `cache:` / `stream:` property *text* into it (`extractObjectProperty` in
   `prepareRpcModule`). The stub carries none of the source module's imports, so a
   policy expression may reference only inline literals — documented (dishonestly, in
   hindsight) as the "self-contained policy" trade-off. `cache: ratePolicy` (imported)
   or `cache: { ttl: RATE_TTL }` (imported const) silently break.
   - The asymmetry is the tell: the **server** rewrite (`rewriteForServer`) keeps the
     module intact and only splices `defineRpc("M","/url",` ahead of the handler — so
     server-side, `schemas` / `cache` can *already* reference imports and separate
     modules today. Only the client path regressed into text extraction.
2. **`props<T>()` must be typed inline.** The shadow (ADR-0010) harvests the props
   type from the inline `prop<T>()` / `props<{…}>()` call literals rather than
   resolving a props type through the module graph, so an imported/aliased `Props`
   type doesn't flow — you must inline it at the call site.

Both are the same anti-pattern: **a build step recovers meaning by scanning inline
source text instead of resolving through the module/type graph the language already
has.** The failure mode is always "you must inline it" — exactly what a framework
built on web standards and real TypeScript should never force. Hand-rolled source
tokenizers (`extractObjectProperty`, the inline-literal props harvest) are the smell.

Separately, the side-crossing guard enforces exactly the edge that matters — a
client-target build rejecting a `$server/*` import (ADR-0017), so server code can't reach
the browser. That single edge is correct and complete (the other namespace edges,
`server → client` and `shared → client`, ship no server code and are contradicted by
abide's own SSR + isomorphic-reactive-core layering, so they must stay unguarded). Its one
weakness is that it fires at *resolve* on textual presence, which would false-positive on
the dead server imports D2's handler-elision leaves behind.

## Decision

### D1 — Build transforms resolve through the module graph, never by lifting inline text

When the bundler or checker needs a value or type an author wrote, it obtains it by
*transforming the real module and letting resolution / tree-shaking / type-checking
run* — never by re-parsing the source and reconstructing a fragment. Inline-text
extraction is deleted wherever it stands in for the graph.

### D2 — The client RPC transform is symmetric with the server rewrite

Replace the whole-module-replace + text-splice with the shape the server already uses:
keep the real module, swap the helper import (`GET → remoteProxy`), inject the
build-time scalars (`method` from the export name, `url` from the file path), and
**elide the handler argument** — leaving `opts` as a *live expression in its original
scope*.

- `opts` (schemas, cache, stream) evaluates as normal JS: it can reference imported
  constants, composed values, and separate modules. The "self-contained policy"
  constraint is deleted.
- The handler, and the imports only it used, become dead code — the bundler
  tree-shakes them out of the client bundle.
- `extractObjectProperty` / `cachePolicyText` / `streamPolicyText` are removed. The
  one irreducible syntactic step is locating the handler-argument span to elide, which
  the plugin already scans for the server rewrite.

**Reconciliation with `remoteProxy` (pinned).** `remoteProxy` already reads
`durable?.outbox`, `durable?.streaming`, `durable?.cache`, `durable?.stream` from its
third argument *at runtime*, so it can take the author's live `opts` object directly and
pick out what it needs — the extra keys (`schemas` / `clients` / `crossOrigin` / `timeout`
/ `maxBodySize`) are ignored. So the emitted client call is:

- no opts, non-streaming → `remoteProxy("M","/url")`
- no opts, streaming → `remoteProxy("M","/url", { streaming: true })`
- opts, non-streaming → `remoteProxy("M","/url", opts)` (opts left as the live expression)
- opts, streaming → `remoteProxy("M","/url", { streaming: true, ...(opts) })`

`streaming` is the *only* genuinely build-injected flag — it's derived from the handler
body (returns `jsonl()`/`sse()`), which the client elides, so it can't ride `opts`.
`outbox` and the cache/stream policy ride the live `opts` and are read at runtime; the
build-time `outbox` scan stays only as the mutating-only + literal validation, no longer
the value source. `remoteProxy`'s third-param type widens to the endpoint opts shape (it
consumes only the four keys above).

Schemas ride the client module too — harmless bytes today, and they open the door to
opt-in client-side validation later. A size-conscious follow-up may prune them, but
never by text extraction.

### D3 — One boundary, reachability-based: no server code survives in the client bundle

The only safety-critical invariant is that **server-only code never reaches the
browser**. That is the single edge worth guarding, and it is already the one ADR-0017
enforces (a client-reachable module importing `$server/*`). The other edges a "full
isolation matrix" would add — `server → client` and `shared → client` — are *not* safety
concerns (they never put server code in a browser bundle) and are actively contradicted
by abide's own architecture: SSR makes `lib/server` render `lib/ui` components, and the
isomorphic reactive core (signals/`track`/`trigger`, filed under `lib/ui/runtime`) is
used by the isomorphic `lib/shared` cache. Guarding those edges would flag SSR and the
shared cache. So the matrix is rejected; the boundary stays a single edge.

The only change is to make that one edge **reachability-based, not presence-at-resolve**.
D2 emits the real rpc module on the client, so the elided handler's now-dead `$server/*`
imports are textually present until tree-shaking removes them; a presence-at-resolve
guard would flag them wrongly. So the guard asks the real question:

> Is any server-only module **reachable from the client bundle** — i.e. does the client
> import server, or anything that (transitively) imports server, in code that survives
> tree-shaking?

- Judged from the post-DCE module graph via `Bun.build`'s metafile, read in a plugin
  `build.onEnd` pass (0017's "guard stays in the plugin" holds; only its timing moves from
  resolve to post-bundle). **Validated on Bun 1.3.14:** `Bun.build({ metafile: true })`
  returns `{ inputs, outputs }`; a textually-imported-but-unused module is *absent* from
  `metafile.inputs` (tree-shaken) while a used one is present, and each input carries
  `imports: [{ path, kind, original }]` edges. So the guard walks `metafile.inputs`,
  classifies each *surviving* module (server-only iff under the server dir and not a
  proxied rpc/socket), and on a hit reconstructs the import chain from the `imports` edges
  — the same evidence `sideCrossingChain` gives today, now DCE-accurate.
- A dead server import a dropped handler left behind is **not** a violation; a server
  import a *live* client-reachable expression (e.g. a policy that references server-only
  state) **is** — an honest error, "move it to `shared/` or behind an rpc", replacing the
  old "inline it" constraint.
- Transitivity is free: a `shared` module that pulls in `server` is caught the moment the
  client reaches it, so no separate `shared → server` edge is needed.
- The carve-out is unchanged: a client import of `$server/rpc/*` or `$server/sockets/*` is
  replaced with a `remoteProxy` / `socketProxy` stub — the isomorphic-callable mechanism,
  not a crossing.

### D4 — component types behave like TypeScript (no inline-only gotcha)

Investigation (`docs/handoffs/adr-0022-d4-props-findings.md`) found the premise was mostly
already true: the shadow is a virtual `.ts` at the source path (ADR-0010), so a
`props<MyProps>()` generic argument — *including* an imported/aliased `MyProps` — already
resolves through the real TS program (a type *reference* stays in a module that carries its
`import type`; TS resolves it natively — not the D1 anti-pattern). The actual gap was narrow:
the TS-idiomatic *annotation* form `const {…}: MyProps = props()` was silently ignored
(`compileShadow.ts` read only the generic arg, defaulting to `Record<string, any>` — a false
negative that let a parent pass anything). The sibling `state`/`computed` branches already
honored both forms via `call.typeArguments?.[0] ?? declaration.type`; the `props` branch just
omitted the fallback. **Fixed** by adding it — both TS-idiomatic forms now resolve
identically, so component prop types behave like TypeScript with no inline-only special case.
(Implemented; the ADR-0010 reference to a singular `prop<T>()` reader was already stale — that
form is removed.)

## Consequences

- **`extractObjectProperty` and the self-contained-policy constraint are deleted.**
  Endpoint policy behaves like ordinary JavaScript on both sides; policy can live in a
  shared module and be imported.
- **The guard stays one edge, but gets more honest.** No new edges — `server → client`
  and `shared → client` remain unguarded (they never ship server code). The single
  client-reaches-server boundary just becomes transitive/reachability-based, so a policy
  that reaches server-only code fails with a real chain instead of silently shipping a
  broken stub.
- **Guard timing moves from resolve to post-bundle.** A violation now surfaces at
  end-of-build rather than at first resolve. The metafile preserves the import chain, so
  evidence is unchanged; `resolverSideCrossing.test.ts` extends to the reachable-vs-dead
  distinction.
- **`props<T>()` accepts an imported type.** Removes the inline-only limitation; the
  shadow harvest becomes a fallback, not the only path.
- **Risk: DCE correctness now matters for correctness, not just size.** A server import
  the bundler *fails* to tree-shake (e.g. a side-effectful `import './x'` the handler
  pulled in) would trip the guard. That is the correct signal — such an import genuinely
  reaches the client — but authors relying on handler-only side-effect imports will see
  a new error. Documented, not worked around.

## Alternatives considered

- **Handler-hoist.** Emit the handler into a generated server-only sibling module and
  import it only on the server; the rpc file becomes client-safe. Cleaner guard story,
  but it must split the file's import list between handler and policy — reintroducing the
  usage analysis the reachability-aware guard avoids by leaning on the bundler. Rejected
  for the extra machinery.
- **Policy in a separate client-safe export/module.** Splits "declared once on the
  endpoint"; worse ergonomics. Rejected — the whole point is one definition.
- **Keep text extraction, widen it to follow imports.** Rebuilds a module resolver by
  hand — the exact anti-pattern D1 rejects.

## Migration

- Revert the ADR-0020 client-shipping mechanism (the `extractObjectProperty` commit,
  `feat(rpc): ship endpoint cache/stream policy to the client stub`) and reimplement via
  D2. Amend the in-flight PR so the endpoint-policy core lands clean and the client
  transform lands on the new mechanism.
- No isolation sweep needed — D3 adds no edges, only makes the existing
  client-reaches-server edge reachability-based. The post-DCE-metafile prerequisite is
  **confirmed** (Bun 1.3.14, see D3), so no fallback is required.
- D4 landed independently (a one-line `?? declaration.type` in `compileShadow.ts` + regression tests).
