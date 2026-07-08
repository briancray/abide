# ADR-0022: Build transforms resolve through the module graph, not inline source text

**Status:** proposed (2026-07-08). Supersedes the client-policy mechanism
introduced for [ADR-0020](0020-cache-policy-on-the-endpoint.md) (the
`extractObjectProperty` text-splice) and broadens the side-crossing guard from
[ADR-0017](0017-side-crossing-guard-stays-inside-the-resolver-plugin.md) — the
guard *stays in the resolver plugin* (0017 holds); only its semantics change.
Touches the shadow from [ADR-0010](0010-template-type-checking-via-virtual-shadow.md).

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

Separately, the side-crossing guard enforces only one edge today — a client-target
build rejecting a `$server/*` import (ADR-0017). The isolation invariant abide's three
namespaces (`server` / `ui` / `shared`) imply is stronger, and unenforced in the other
directions.

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

Schemas ride the client module too — harmless bytes today, and they open the door to
opt-in client-side validation later. A size-conscious follow-up may prune them, but
never by text extraction.

### D3 — The side-isolation guard becomes reachability-aware and covers the full matrix

D2 emits the real module on the client, so the handler's now-dead `$server/*` imports
are textually present until tree-shaking removes them. A presence-at-resolve guard
would flag them wrongly. Two changes:

- **Reachability-aware, not presence-at-resolve.** A side-crossing is an illegal module
  that *survives into the emitted bundle*, judged from the post-DCE module graph (an
  `onEnd` pass over the bundle metafile in the same plugin — 0017's "guard stays in the
  plugin" holds; only its timing changes). The import chain is reconstructed from that
  graph for the same evidence `sideCrossingChain` gives today. A dead server import a
  dropped handler left behind is **not** a violation; a server import a *live* policy
  expression actually reaches **is** an honest error — "your cache policy depends on
  server-only state; move it to `shared/` or behind an rpc" — which replaces the old
  "inline it" constraint.
- **Full matrix.** Enforce the complete isolation invariant the three namespaces imply,
  both directions:

  | importer ↓ \ target → | `shared` | `server` | `client` |
  |---|---|---|---|
  | **shared** | ✓ | ✗ | ✗ |
  | **server** | ✓ | ✓ | ✗ |
  | **client** | ✓ | ✓ \* | ✓ |

  `shared` imports only `shared` — a side dependency makes it non-isomorphic, which is
  the whole point of the namespace. `server` and `client` are independent leaves that
  may use `shared` but never each other. **(\*)** the one carve-out stays: a client
  import of `$server/rpc/*` or `$server/sockets/*` is replaced with a `remoteProxy` /
  `socketProxy` stub — the isomorphic-callable mechanism, not a crossing.

### D4 — `props<T>()` resolves its type through the shadow's real program

The shadow is already a virtual `.ts` at the source file's own path (ADR-0010), so its
imports resolve. Extend it so a component's props type may be resolved *through that
program* — an imported or aliased `Props` — rather than only the inline `prop<T>()`
literal harvest. Same principle as D1: use the type graph TS already has, don't lift a
literal.

## Consequences

- **`extractObjectProperty` and the self-contained-policy constraint are deleted.**
  Endpoint policy behaves like ordinary JavaScript on both sides; policy can live in a
  shared module and be imported.
- **The guard gets stricter and more honest.** Three previously-unenforced edges
  (`shared → server`, `shared → client`, `server → client`) now fail the build; a
  policy that transitively reaches server-only code fails with a real chain instead of
  silently shipping a broken stub. Expect a one-time sweep to fix any latent crossings
  the old one-edge guard never caught.
- **Guard timing moves from resolve to post-bundle.** A violation now surfaces at
  end-of-build rather than at first resolve. The metafile preserves the import chain, so
  evidence is unchanged; `resolverSideCrossing.test.ts` extends to the new edges.
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
- Sweep the codebase for the three newly-guarded edges before flipping D3 on; fix or
  relocate any crossing (`shared/*` importing a side, `server ↔ client`).
- D4 can land independently of D2/D3 (separate subsystem).
