# ADR-0031: Reuse the new type-graph seams (script-region classification, post-DCE metafile)

**Status:** **D2 accepted, D1 deferred** (2026-07-09). Records two *general* capabilities
that fell out of the ADR-0019..0028 work as side effects, so they are recognized as reusable
core seams rather than one-off machinery — and names the first concrete consumer of each.
Depends on nothing new; both seams already exist and are exercised by shipped features. **D2
(the post-DCE metafile seam + a bundle-budget diagnostic) shipped.** D1 (sharpen the post-await
lint) is **deferred** — its precision spike passes but the change would not move the ADR's
motivating cases; see *Spike findings* below.

## Spike findings (2026-07-09)

- **D2 — metafile granularity: PASSES.** `Bun.build`'s metafile (`BuildMetafile`) exposes
  `inputs[key]` = `{ bytes, imports[], format }` and `outputs[key].inputs[key].bytesInOutput`.
  A tree-shaken module is ABSENT from `inputs` entirely (confirmed: a module imported but never
  referenced does not appear), so `inputs` IS the post-DCE graph and per-module SURVIVAL +
  source BYTE SIZE are both available. It does **not** expose export-level liveness — so a
  "reachable-but-unused *endpoint*" diagnostic at export granularity is unsupported, but a
  **bundle-budget** diagnostic (a surviving input over a byte budget) is fully supported. Shipped
  the budget consumer for that reason; the dead-endpoint variant is not viable off this metafile.
- **D1 — classifier precision: PASSES, but the change is inert.** A checker spike confirms the
  script-region seam distinguishes a reactive read (`count()` after `await` resolves to a callable
  `() => T` signal accessor) from a shadowed inert local (`const count = await …` resolves to a
  plain non-callable value) — precision is good. BUT the *current* post-await warning already
  scans only identifiers whose name is in the component's reactive-binding set (`signalNames`), so
  it never fires on the ADR's motivating inert captures (a nonce/timestamp/requestId — those are
  not signal names and are already unflagged). The only false positive the classifier would
  suppress is a *same-name local shadow* of a signal — rare — and doing so needs a NEW
  reactive-type predicate (not the existing async/promise/sync `classifyInterpolationType`)
  threaded through two lowering helpers, for a warning-only refinement. Cost outweighs the win;
  **deferred**. If a strict flag or a real shadow-noise report later justifies it, the seam is
  ready and the predicate is small.

## Context

Two mechanisms built for narrow purposes are actually general:

1. **Script-region type classification.** ADR-0023 D2 proved the warm shadow program's
   `mappings` resolve a `<script>`-region source location to a shadow offset (its "central
   risk," landed). Today only the `computed`/`linked` seed classifier uses it. But *any*
   `<script>` expression can now be type-classified through the same resolver — the capability
   is broader than its one caller.
2. **The post-DCE metafile pass.** ADR-0022 D3 added a `build.onEnd` walk of `Bun.build`'s
   metafile to judge the side-crossing guard on the *surviving* module graph. That walk is a
   general post-bundle analysis seam; today it powers one guard.

Recognizing these as seams (with a first consumer each) prevents them being re-invented and
keeps the "resolve through the real graph" discipline (ADR-0022 D1) from stopping at the features
that first needed it.

## Decision (sketch)

### D1 — sharpen the post-await tracking lint with the script-region classifier

ADR-0019 D2.3 ships the post-await tracking check as a **syntactic** warning: a signal read after
the first `await` in a wrapped async thunk runs outside tracking and silently fails to trigger
re-runs. The check is imprecise (it warns on legitimate capture-once reads) *because* it reasons
about syntax. The script-region classifier (D-context #1) can ask the real type — is the
post-await read a reactive source (a signal/cell) or an inert captured value? — turning an
imprecise syntactic warning into a type-precise one. Stays a **warning**, fail-open (no shadow
program ⇒ today's syntactic check), exactly as ADR-0019 framed it, "leaving room to upgrade under
a strict flag."

### D2 — expose the post-DCE metafile pass as a named analysis seam (SHIPPED)

Factor the `build.onEnd` metafile walk so a second consumer can register a pass over the
surviving module graph without duplicating the walk. **Shipped as `bundleGraphFromMetafile`
(`lib/shared/`)**: it walks the metafile once into a `BundleGraph` (`{ modules: {path, bytes}[],
importerChain(target) }`), and the resolver plugin's `onEnd` now reads that graph for BOTH the
side-crossing guard (unchanged behavior — the first surviving server-only module still throws with
its chain) and the new consumer. First concrete consumer shipped: a **bundle-budget** diagnostic —
a project `src/` module that survives DCE over a per-input byte budget
(`CLIENT_BUNDLE_INPUT_BUDGET_BYTES`, 512 KiB) earns a non-blocking `abideLog.warn` with its import
chain, never a build failure. The alternative "dead-endpoint" variant (an `$rpc/**` stub present
but never client-reachable) was dropped: the metafile carries no export-level liveness (D2 spike),
and the rpc manifest dynamically imports every endpoint, so module-presence can't judge it.
The only hard `onEnd` failure remains the real side-crossing violation (a client-reachable
`$server/*`).

## Consequences (anticipated)

- **The two seams get named and reused** rather than re-derived the next time a feature needs
  "the type of a script expression" or "walk the real post-DCE graph."
- **The post-await lint stops crying wolf** (D1, DEFERRED) — the intended win; the spike showed the
  current warning is already name-scoped to reactive bindings and so doesn't fire on capture-once
  reads (nonce/timestamp), leaving only a rare same-name shadow to fix. Not worth the threading.
- **Bundle/endpoint hygiene becomes observable** without a new bundler pass — it rides the metafile
  walk the guard already does.

## Open questions (resolved by the spikes)

- **Is the script-region classifier's precision good enough to gate the lint's noise reduction?**
  RESOLVED — precision is good (the checker distinguishes a callable signal accessor from a plain
  captured value), but the lint doesn't actually cry wolf on inert captures today, so the win is
  inert. D1 deferred (see *Spike findings*).
- **Does the metafile carry enough to judge "dead endpoint" vs. "reachable but unused-this-build"?**
  RESOLVED — it carries module presence + input byte size, NOT export-level liveness. So the
  bundle-budget diagnostic is supported and shipped; the endpoint-liveness variant is not.
- **Priority.** Both were refinements, not gaps. D2 shipped as the self-contained win; D1 stays
  recorded so the seam isn't lost.
