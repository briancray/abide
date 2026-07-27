# abide — performance philosophy

> How to decide what is worth speeding up, how to prove it, and how to know when to stop.
> Specs are authoritative in `docs/spec/*.md`; `CLAUDE.md` carries the short rules this doc explains.

This is a working method, not a wish list. It exists because a sweep that measures the wrong thing
produces confident, wrong answers — and most of the wrong answers recorded below were mine.

## 1. The unit is a ratio, in the same substrate

A performance claim is `abide ÷ the same work hand-written`, both timed by the same harness, in the
same process, on the same machine. Absolute nanoseconds describe the machine. The ratio describes the
framework, and it survives new hardware and a new laptop.

This is why every bench scenario ships a hand-written baseline (`packages/bench/src/vanillaBaselines.ts`)
and why the runner asserts the baseline's output matches abide's before timing it. A baseline that
drifted into doing less work produces a flattering number and nobody notices.

**A ratio is only meaningful against an equivalent baseline.** Two live counter-examples:

- `unmount` runs ~27× vanilla, but the baseline is `host.replaceChildren()` — one engine call, which a
  framework tracking per-item disposers cannot use by construction. That ratio is definitional, not
  overhead. Do not "fix" it.
- `state/computed-chain-5` runs ~13×, but the baseline recomputes with no memoization at all. Read the
  absolute (~110 ns per link) instead.

When a baseline is not equivalent, say so next to the number rather than quoting the ratio.

## 2. Measure before you change anything

Every hypothesis in a sweep is a guess until ablated. The record from one session:

| guess | reality |
|---|---|
| `Object.defineProperty` on component props is the boundary cost | 67 ns — **1.3%** of the row |
| `keyFor`'s per-item `Object.create` is the reconcile floor | 4 ns/item — **4%** |
| `list-select` at 530× is a reactive fan-out defect | **96% happy-dom's `classList.toggle`**; effect dispatch was 27 ns, exactly raw observer cost |

Three confident guesses, three wrong. The cost of checking was minutes; the cost of not checking would
have been a risky refactor sized off a fiction.

Ablate by building the emitted or runtime shape in a standalone script and removing one layer at a
time. The layer that moves the number is the one to fix.

## 3. The substrate trap

The CLI bench (`bun run bench`) runs under happy-dom, whose `insertBefore` is **superlinear**. It will
tell you list mount degrades with size. It does not:

| rows | happy-dom | real browser |
|---|---|---|
| 100 | 4.6× | 8.0× |
| 10 000 | 14.6× | 8.8× |

Flat in a real browser. happy-dom was wrong in **both** directions — understating small lists and
overstating large ones. Any claim about DOM-op cost must come from `/platform/bench/client`, which runs
in the real browser. happy-dom is fine for SSR `render` (string building, no DOM) and for the
primitives bench (no DOM at all).

## 4. Three budgets for emitted code

In a compiler-based framework the emitted shape *is* the performance model. Nothing about
`<li>row {n}</li>` suggests it costs two promise suspensions, but it did. Count, per emitted template:

- **allocations per template node** — scope objects, props objects, closures, arrays
- **microtask ticks per row** — every `await`, including `await` of an already-settled value
- **DOM nodes per list item** — anchors and markers are a budget even though they render nothing

Those three numbers predicted every real finding in the session that produced this doc. A `{#for}` row
carried 3 DOM nodes (2 were bookkeeping); a component site carried 3; a component inside a `{#for}`
carried 5. All are now 2, 2 and 3.

## 5. Reactive code: assert wake-ups, not values

A correctness suite cannot see work that should not have happened. Three propagation bugs shipped
under a green `memo` suite because **every test asserted values, and the values were always right**.
Only the wake-ups were wrong.

When the contract is "does less work", the test has to count the work:

- effect re-runs and body runs, for propagation
- relocated nodes (via `MutationObserver`), for a reconcile
- DOM operations, for a mount

`src/ui/internal/forReconcile.test.ts` and the propagation tests in `src/shared/memo.test.ts` are the
worked examples. Both were written *after* verifying they fail against the bug they guard.

**Always verify a new guard fails for the right reason.** Reintroduce the bug, watch the test fail,
restore. A guard that has never failed is a guard that may be asserting nothing.

## 6. The failure mode to grep for first: a fresh wrapper

`reactive.ts` cuts propagation on `oldValue !== value`. Any value re-wrapped in a fresh envelope per
run makes that comparison unconditionally true, and **every cutoff downstream silently stops working**.
It does not throw. It does not fail a test. The values stay correct.

This was the same root cause in three separate places in `memo` — the auto-tracked `merged`, `setState`
on the keyed path, and `refreshing` living inside the state envelope. When sweeping reactive code, look
for object literals built inside a `computed`/`effect` body before looking anywhere else.

Related: two axes sharing one signal is the same bug wearing a different hat. `refreshing` inside
`SlotState` meant a spinner flip woke every value reader. Split the signal; the identity check then has
something stable to compare.

## 7. Deciding whether a fix is worth it

Write both columns before touching code.

**Worked example — `pending`/`error` readers still wake on a value change:**

| leaving it | fixing it |
|---|---|
| 2 spurious wakes per value change, per reader of that slot | 2 extra `State` cells per slot, **always** |
| 244 ns per wake → ~489 ns per value change | 52 ns per cell → 104 ns per slot |
| per-slot, never O(n) | paid by every slot, including the majority with no probe reader |

Break-even is one value change — so it wins for slots that change *and* have a probe reader. But most
slots load once and never change again, so the tax lands on the population that gains nothing. Verdict:
**not fixed**, and `setState` carries a comment saying so.

Contrast `refreshing`, which was fixed: it woke **value** readers, twice per refresh, on the most common
reactive shape there is. Same class of bug, opposite verdict, because of where it landed.

Two standing rules:

- **Over-notifying is safe; under-notifying is not.** A propagation fix that risks missing an update
  needs a much larger payoff than one that only removes redundancy.
- **Record the decision where the code is**, not just in a commit message. A future sweep re-derives
  everything otherwise.

## 8. Benchmark cases must distinguish implementations

A case earns its place by telling two implementations apart, not by looking representative. The corpus
had `list-reverse-1000` but no swap — and reverse is O(n) moves under *any* algorithm, so it structurally
could not detect that a two-row swap was moving 996 rows. That defect sat in a fully-benched hot path.

A case that *disproves* a suspicion is worth as much: `deep-tree-10` came back at 1.2× and killed the
"per-level overhead hides in depth" theory with evidence rather than argument.

**Do not silently cap coverage.** A skipped scenario must fail loudly — the browser bench used to
`continue` past a scenario missing from its scope list, quietly measuring less than it claimed to.

## 9. Know what is inherent before chasing it

Some cost is the framework being itself. A sweep that attacks these is wasted effort:

- **fine-grained + hydratable SSR ⇒ per-value DOM identity.** `<p>{a} … {h}</p>` builds 8 text nodes and
  8 anchors where vanilla writes one `textContent`. That is the price of updating each value alone.
- **declarative bindings express *what*, not *which*.** `class:sel={n === selected}` must evaluate 1000
  predicates to discover 2 changed. You cannot derive a delta from a predicate without running it.
- **value semantics on lists ⇒ a diff.** `items = [...items].reverse()` hands over a new value, never the
  operation, so the reconcile must rediscover it. This is the only one with a real API escape (an
  operation-taking list surface), and it costs surface area.
- **components are boundaries, not calls.** A second mount frame, props object, child scope and region
  bounds — buying independent reactivity, `<script>` teardown, slots and localized hydration recovery.

Reads subscribing (probes at 3.5–4.3× a field read), auto-tracked dependency discovery, and batched
glitch-free notification (~27 ns/observer) are likewise the model working, not overhead.

## 10. Where the numbers come from

| surface | command / route | good for |
|---|---|---|
| frontend corpus | `cd packages/bench && bun run bench` | SSR `render`; relative mount/unmount/update |
| primitives | `bun run bench:server` | `state`/`memo`/probes/streams/channel/route |
| before vs after | `bun run bench:delta` | working tree against a base git ref |
| SSR render, live | `/platform/bench` | streamed render bench + the O(n) gate |
| **real browser** | `/platform/bench/client` | **any DOM-op claim** — mount, unmount, hydrate, update |

Adding a scenario touches **five** places, and the e2e specs are what stop it silently vanishing:
`packages/bench/src/scenarios.ts`, `src/vanillaBaselines.ts`, the docs page's `scopesFor`
(`src/ui/pages/platform/bench/client/page.abide`), and both `packages/docs/e2e/bench.spec.ts` and
`bench-client.spec.ts`.

Scenarios are deliberately **stable** — changing an existing one breaks historical comparability. Add a
new one instead. Two metrics have already broken that continuity and are marked in `run.ts`: `mount` no
longer includes teardown, and `unmount` has no history before the split.

## 11. Sweep checklist

1. Run the corpus and the primitives bench. Note anything above ~5× with an *equivalent* baseline.
2. For DOM claims, re-read the number in the real browser before believing it.
3. Pick the worst ratio and **ablate** — do not guess which layer owns it.
4. Check §9: is this inherent? If so, stop and write down why.
5. Write the cost-of-leaving / cost-of-fixing ledger (§7). Decide before implementing.
6. Implement. Add a guard that measures **work**, not output (§5), and prove it fails against the bug.
7. Re-measure on the surface that showed the problem. Confirm the number actually moved.
8. Full gates: `bun test` from `packages/abide`, `bun run typecheck`, `bunx biome check`, and
   `bun run e2e:ci` in `packages/docs` for anything touching emit, runtime or the reactive core.
9. Record the *mechanism* in a comment at the site — including for anything tried and rejected.
