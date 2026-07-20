# Attach-hydration design (TODO #2, built on #1) — resolved decisions

Outcome of a design grilling on 2026-07-18. Resolves how abide moves from the current
fresh-mount-over-SSR to true C2 attach-hydration. Every decision below was chosen deliberately;
alternatives considered are noted so the reasoning survives.

Prerequisite already landed: the §5 hydration seed (RPC reads recorded into `#__abide-seed` + the
soft-nav envelope, replayed into client cells before mount). See `rpc-core.md` §5.

## Resolved decision tree

1. **Hydration rides on the AOT compiler (#1), not the current runtime interpreter.** `#2` is
   sequenced strictly after `#1`. Rejected: threading a claim cursor through the existing
   `renderClient.ts` interpreter (would duplicate claim-logic again when #1 lands).

2. **#1's emitter is hydration-aware from day one; #1 and #2 are one design in two ship-stages.**
   #1 is not a pure "de-eval" refactor — it absorbs the hydration marker/structure design so #2 does
   not re-open the emitter. Rejected: mount-only #1 with a later hydrate retrofit (re-creates the
   duplication one layer down).

3. **Emit strategy: template-clone + cursor walk (Svelte 5 / Solid style).** Per template, emit a
   static HTML skeleton string + a traversal (`firstChild`/`nextSibling`) that locates dynamic
   nodes. Mount = `template.cloneNode(true)` then walk the clone; hydrate = the *identical* walk over
   the server DOM. The walk is authored once. Implies **#1 replaces both `renderServer.ts` and
   `renderClient.ts` with one shared emitter** (two structurally-aligned targets — drift becomes
   impossible by construction). Rejected: imperative `createElement` emit (needs a parallel claim
   walk).

4. **Dynamic boundaries marked with comment anchors; static structure is positional.** Paired
   `<!--[-->…<!--]-->` around blocks (unambiguous even when a block renders zero children), a single
   `<!---->` anchor per interpolation (client interpreter already does this). Comments confined to
   *dynamic* slots only, so byte cost is proportional to how dynamic the page is. Rejected: sentinel
   data-attributes (useless for text/empty regions), pure-positional (desyncs on merged text /
   empty regions).

5. **Mismatch policy: localized recovery.** Cheap verification as the cursor walks (tag name at
   element boundaries, comment-anchor presence at dynamic boundaries — NOT attribute equality, since
   attributes are re-applied on claim). On mismatch, discard that region's server nodes and
   create-from-scratch for that subtree only; keep the rest of the claimed page; dev-warn with the
   path. Whole-page fresh-mount is the last-resort backstop only if the top-level container is
   unrecoverable. Because server + client come from one emitter (#3), mismatch can only arise from
   non-deterministic render (see 10), external DOM mutation before hydrate, or browser HTML
   normalization on parse. Build-time normalization guard is **deferred** — rely on the runtime
   dev-warning now, fold a real check into #11 template type-flow later.

6. **Soft-nav unifies onto the hydrate path.** The server already renders the destination inner HTML
   on nav (that render is also how `collectSeed` produces the seed). The client swaps `envelope.html`
   in, replays `envelope.seed`, then runs the *same claim walk* as initial load. One hydrate path
   total. `navigate.ts`'s `innerHTML = envelope.html` + fresh-mount becomes innerHTML-swap + hydrate.
   Rejected: data-only soft-nav envelopes (would reintroduce client fetch waterfalls or force a
   second "execute reads without rendering" path to compute the seed).

7. **Event listeners: direct attach during the claim walk.** The walk visits every dynamic element
   to wire reactivity anyway, so attaching listeners there is free. Rejected/deferred: global event
   delegation + the progressive-interactivity it enables (orthogonal to correctness, changes event
   semantics — a clean follow-up once attach is correct).

8. **First ship is plain attach; static-subtree (island) skipping deferred.** The walk traverses
   every node for cursor sync (cheap tag check) but only *wires* dynamic ones. No island boundary
   markers. Skipping is deferred because (a) not-traversing static subtrees forfeits the
   localized-recovery net exactly where normalization mismatches hide, and (b) it needs extra
   markers. The emitter keeps its static/dynamic analysis so true skipping drops in later.

9. **On claim, trust server output — suppress the initial reactive write.** Bindings are wired for
   *future* updates but not run to set the initial value; the server rendered it correctly and the
   replayed seed means the cell already holds that value. This is the definition of no-flash: never
   repaint a node the server got right. Rejected: eager recompute-on-claim (churn always, flash when
   values don't match).

10. **State-initializer record/replay is IN SCOPE for #2 (hard prerequisite).** Because 9 suppresses
    the initial write, a non-deterministic `state(Date.now())` would leave the server value in the
    DOM while the client cell holds a different value — a *silent jump* on the first update, which
    localized recovery cannot catch (we deliberately don't recompute to compare). So the emitter
    (being written in #1) records each `state()` initial value on the server into the seed; the
    client `state()` uses the seeded value instead of re-evaluating its initializer. Same
    record/replay machinery as the RPC-read seed, extended to per-instance state cells via a
    render-lifecycle hook in the emitted server render. Rejected: RPC-reads-only first ship (ships a
    silent-desync footgun).

## Ship staging

- **Stage 1 — #1 emitter.** Replace `renderServer.ts` + `renderClient.ts` with one codegen: SSR
  HTML target (with comment anchors) + client module. Client mounts from emitted code — no more
  `new Function`/`with` (the CSP/no-eval win); the seed keeps working; claim path present but
  stubbed. **Fold #13 (scoped styles) in here** — selector-rewrite + scope-attribute emission is a
  pure emit-time transform, cheapest while the emitter is being authored, independent of hydration.
  Shippable and testable on its own.
- **Stage 2 — #2 hydration.** Flip on the claim walk, suppress-initial-write, state-initializer
  recording, localized recovery, and the soft-nav unification.
- **#11 (template type-flow)** stays a separate follow-up, but Stage 1's emitted code must be
  type-checkable (real identifiers, no `with`) so #11 becomes "point `abide check` at the emitted
  TS," not another emitter change.

## Regression oracle

While both stages are in flight, keep the current interpreters (`renderServer.ts`/`renderClient.ts`)
as a reference oracle: assert emitted-module output matches interpreter output across the existing
`renderServer.test.ts` / `renderClient.test.ts` / `assemble.test.ts` fixtures, then delete the
interpreters once parity holds. Add a browser-lane no-flash/no-refetch assertion for hydrate
(mirroring the existing seed-replay browser test in `browserBundle.test.ts`).
