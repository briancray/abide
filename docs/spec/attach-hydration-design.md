# Attach-hydration design (TODO #2, built on #1) — resolved decisions

Outcome of a design grilling on 2026-07-18. Resolves how abide moves from the current
fresh-mount-over-SSR to true C2 attach-hydration. Every decision below was chosen deliberately;
alternatives considered are noted so the reasoning survives.

Prerequisite already landed: the §5 hydration seed (RPC reads recorded into `#__abide-seed` + the
soft-nav envelope, replayed into client memos before mount). See `rpc-core.md` §5.

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

   > **Refinement (mountable interpolations) — SUPERSEDED; the case no longer exists.** An interpolation
   > whose value was a *mountable* (the `{Name(…)}` component-call form) rendered a whole subtree, not a
   > scalar. The single trailing `<!---->` is ambiguous there, so the server bracketed such a value with
   > the block anchors — a shape chosen at RENDER time by `Raw`-ness — and the client walk
   > (`hydrateInterpLeaf`) peeked for the leading `<!--[-->` to skip/adopt the region.
   >
   > **That made one leaf position two shapes, decided outside the plan.** The call form is now REMOVED: a
   > component is invoked as a TAG (`<Name/>`), which is a component slot with statically-emitted paired
   > anchors on both emitters. (`{children()}` was never really this case either — `templatePlan` lowered
   > it, like `<slot/>`, to a component slot — and it has since been removed outright, leaving `<slot/>`
   > as the outlet's only spelling.) So an interpolation leaf is ALWAYS one scalar position, `renderLeaf`
   > emits one shape, `hydrateInterpLeaf` is gone, and `hydrateValueLeaf` claims every non-`html` leaf.
   > `templatePlan.rejectComponentCall` rejects the statically visible form at compile time; `renderLeaf`
   > and `runtime.interpolate` throw on the one it cannot see (a component arriving through props).

   > **Refinement (`{html(...)}` regions).** Raw markup is the one slot whose extent the plan genuinely
   > cannot describe — its shape is a runtime value. The claim used to RE-DERIVE that extent: scan forward
   > for the first empty-data comment to find the end, then re-parse the markup in a probe `<div>` and walk
   > back that many nodes. Unsound three ways — markup containing `<!---->` (abide's own SSR output does)
   > truncated the region; a context-sensitive parent mis-counted (`<td>` in a `<tr>` is dropped by the
   > probe); and markup whose leading text merged with the preceding static sibling claimed one node too
   > many, so the first update **deleted the static prefix**.
   >
   > The region is therefore BRACKETED like a block, but with its own **collision-checked** delimiter:
   > `serverRuntime.renderHtml` escalates a numeric suffix (`<!--[h-->`, `<!--[h0-->`, …) until the close
   > marker is provably absent from the markup, so content can never terminate its own region. The claim
   > READS the extent (`claimRoots(nextSibling(open), close)`) — no probe, no count. `findHtmlClose` takes
   > the committed token off the open anchor, so no depth counting is needed. The token is chosen at
   > RENDER time, and that is fine: the criterion is not staticness but **unambiguity** — unlike the
   > superseded `Raw` peek above, here the server proves the marker is unique before committing to it.

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

   **Exception — correct a KNOWN divergence.** Suppression means "don't recompute to compare", not
   "never write". Where pass 1 already holds the client value without recomputing anything, it is
   compared against the claimed node and corrected on mismatch — writing only when the values
   actually differ, so an agreeing value still costs zero DOM writes and the anti-churn property of
   the rejected alternative is preserved. Two cases in `ui/internal/runtime.ts`:

   - a **client-only value** (e.g. a `bind:element` node ref set during mount, before the effect
     first ran) — the original exception, scalars only;
   - a **settled read**: an already-resolved coalesced load carries a synchronous value hint
     (`shared/internal/settledRead.ts`), so a thenable is no longer opaque on pass 1 either.
     `interpolate` and `awaitText` consume it exactly like a scalar.

   With **no** hint the read is genuinely pending on the client (the server painted, but this slot
   was not seeded): pass 1 keeps the server text *and registers the fill*, so resolution converges
   the node. It must not simply return — the effect re-run that would otherwise deliver the value
   depends on a signal change a settle-on-arrival read may never emit, stranding the server value
   indefinitely.

   NB the settled write is **not** a paint fix. Blank-then-microtask-refill is never visible
   (microtasks drain before the rendering steps); what it buys is a DOM correct *synchronously*
   after mount, for anything reading without awaiting — measurement, soft-nav scroll/focus
   restoration, tests. The only genuinely visible blank is a cold read waiting a network round trip,
   which this does not change.

10. **State-initializer record/replay is IN SCOPE for #2 (hard prerequisite).** Because 9 suppresses
    the initial write, a non-deterministic `state(Date.now())` would leave the server value in the
    DOM while the client cell holds a different value — a *silent jump* on the first update, which
    localized recovery cannot catch (we deliberately don't recompute to compare). So the emitter
    (being written in #1) records each `state()` initial value on the server into the seed; the
    client `state()` uses the seeded value instead of re-evaluating its initializer. Same
    record/replay machinery as the RPC-read seed, extended to per-instance state cells via a
    render-lifecycle hook in the emitted server render. Rejected: RPC-reads-only first ship (ships a
    silent-desync footgun).

    > **Refinement (bucket identity).** Initials are grouped per component instance, and the first
    > implementation identified an instance by a shared MOUNT-ORDER counter, assumed to advance
    > identically on both sides. It does not. `{#for await}` clears its region on hydrate and re-drains it
    > in a microtask, so the client counts none of those components during the synchronous claim pass while
    > the server counted every streamed item in document order — and every component AFTER the block reads
    > a different bucket on each side. That is precisely the silent jump this decision exists to prevent,
    > arriving through a door it did not cover, and it is invisible to localized recovery (the structure is
    > right; only the value is wrong).
    >
    > An instance is therefore identified by WHERE IT IS, not WHEN IT MOUNTED: a **site path** built from a
    > stable per-module `siteId` (assigned in `templatePlan`, read by both emitters, passed as the
    > adapter's 4th argument) plus, inside a loop, the item index — `/<siteId>` per component, `#<index>`
    > per item, `""` for the page + its layouts. Computed from the template, so it cannot shift with mount
    > timing; and when the two sides genuinely differ (a streamed item whose value changes on re-drain) the
    > key misses and the cell falls back to its literal initial — safe degradation, not corruption.
    > This does NOT make streamed-item state survive hydration; only a same-node `{#for await}` claim does.

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
