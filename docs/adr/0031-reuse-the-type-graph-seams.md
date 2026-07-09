# ADR-0031: Reuse the new type-graph seams (script-region classification, post-DCE metafile)

**Status:** proposed (2026-07-09). Records two *general* capabilities that fell out of
the ADR-0019..0028 work as side effects, so they are recognized as reusable core seams
rather than one-off machinery — and names the first concrete consumer of each. Depends
on nothing new; both seams already exist and are exercised by shipped features.

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

### D2 — expose the post-DCE metafile pass as a named analysis seam

Factor the `build.onEnd` metafile walk so a second consumer can register a pass over the
surviving module graph without duplicating the walk. First concrete consumer: a **dead-endpoint /
bundle-budget** diagnostic (an `$rpc/**` module whose client stub is present but never
client-reachable, or a bundle input that blew a size budget) — surfaced as a build log, never a
hard failure, matching the guard's non-blocking posture except where a real violation (a
client-reachable `$server/*`) demands an error.

## Consequences (anticipated)

- **The two seams get named and reused** rather than re-derived the next time a feature needs
  "the type of a script expression" or "walk the real post-DCE graph."
- **The post-await lint stops crying wolf** — a capture-once read (nonce, timestamp) no longer
  warns, only a genuinely-lost reactive read does, so the warning becomes trustworthy.
- **Bundle/endpoint hygiene becomes observable** without a new bundler pass — it rides the metafile
  walk the guard already does.

## Open questions (discovery-first)

- **Is the script-region classifier's precision good enough to gate the lint's noise reduction?**
  It must distinguish a reactive source from an inert value at a post-await read site; spike on
  real components before flipping the warning's basis.
- **Does the metafile carry enough to judge "dead endpoint" vs. "reachable but unused-this-build"?**
  ADR-0022 D3 validated presence/absence of *modules*; endpoint-level liveness may need the export
  granularity the metafile may or may not expose. Confirm before promising the diagnostic.
- **Priority.** Both are refinements, not gaps — lower urgency than the input/output codec work
  (ADR-0028/0029/0030). Recorded so the seams aren't lost, sequenced after the codec line.
