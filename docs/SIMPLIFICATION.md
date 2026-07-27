# abide — simplification philosophy

> How to find code that can be removed without changing behaviour, how to prove the behaviour really is
> unchanged, and when to leave it alone.
> Sibling: `docs/PERFORMANCE.md` (making code faster). Same method, three principles inverted — §2.

**To run a hunt** — one session, several agents, each on its own territory — read §1–§8 for the method,
then work from §9. That section carries the territories, the evidence a finding must show, and the
report shape. §9 is the operational part; everything before it is why.

## 1. The code worth removing is code that is USED

Static tooling finds *unreferenced* code. That is not where the weight is. This repo has no knip, no
`ts-prune`, no `noUnusedLocals` — and adding them would not have found a single thing removed in the
session that produced this doc:

| removed | why a tool would miss it |
|---|---|
| `$indexState` per `{#for}` item | constructed AND `.set()` every reconcile — a writer, no reader |
| `$itemState` on the destructured path | same shape; the binding rebinds from `$value` instead |
| `$start` factory parameter | unreferenced, but in *generated* code no tool inspects |
| `<!--Name-->` component marker | created, inserted, removed — fully used, redundant with the close anchor |
| `<!--for-->` item start marker | genuinely read by `moveRange` — but derivable from the sibling chain |
| `refreshing` inside `SlotState` | read by its own probe; the fault was two axes sharing one signal |

Every one came from asking **"who reads this, and could they get it another way?"** — not from asking
what is unreferenced. Run the linters if you like; they are cheap. They are not the hunt.

## 2. Three things invert from the performance method

Read `docs/PERFORMANCE.md` first: measuring before changing, proving a guard fails, the cost ledger,
and knowing what is inherent all carry over unchanged. These three do not.

**The unit.** Performance has a magnitude and a threshold — "above ~5× with an equivalent baseline, go
look". Removal has no magnitude. The behavioural delta must be exactly **zero**. It is a proof of
equivalence, not a measurement, so triage asks *what would break*, never *how big*.

**The burden of proof follows how loudly failure arrives.** Two opposite verdicts on the same class of
change, one session apart:

- The `{#for}` start markers were removed. If wrong, the list renders in the wrong order — caught
  instantly by a fuzz test over arbitrary mutations.
- The component anchor pair was **not** removed, with ~18% of the component boundary on the table. If
  wrong, a page corrupts *only under a hydration mismatch* — rare, production-only, and nothing in the
  suite would catch it.

**Removal is safe in proportion to how loudly its absence fails.** Silent-and-conditional failure is the
disqualifier, not size of the change.

**The substrate trap becomes the coverage trap.** happy-dom lies about DOM cost; a green suite lies
about whether code is needed. 1317 tests passed with three live propagation bugs — they would pass just
as happily if you deleted something untested. **"Tests still pass after deleting it" is evidence of
nothing** until you have shown the tests discriminate. Establish that first, by breaking the code
deliberately and watching something go red.

## 3. Grep for these first

Shapes that recur, each with a live example from this repo:

- **Written but never read** — a value with a setter and no getter. `$indexState` was `.set()` on every
  reconcile of every row and read by nothing.
- **Two things serving one role** — a range bounded by both a leading and a trailing marker when one end
  plus a derivation suffices.
- **A parameter threaded but unreferenced** — `$start` sat in the emitted factory signature untouched.
- **A field read only to copy itself forward** — `refreshing: current.refreshing`, present only to
  survive a rebuild it should not have needed.
- **Two axes sharing one carrier** — a status flag inside a value envelope, so each wakes the other's
  readers. Splitting removes code *and* fixes behaviour.
- **A wrapper whose only job is to call through** — a frame that allocates an array and a closure to
  invoke one function.
- **Branches whose arms are identical** after the surrounding code changed.

In generated code, read the *emitted output* rather than the emitter. `$indexState` and `$start` were
obvious in fifteen lines of emitted JavaScript and invisible in the emitter that produced them.

## 4. Prove equivalence with an oracle, not a hunch

This repo already has behaviour-equivalence oracles, and a removal should be routed through them
deliberately:

- **Emit snapshots** (`src/ui/internal/__snapshots__/emit.oracle.test.ts.snap`) diff rendered SSR output
  and mounted DOM per fixture. The marker removals showed as *exactly* 22 changed lines, every one a
  marker deletion — that diff **is** the proof, and anything else appearing in it is the finding.
- **The bench corpus** asserts abide's output matches its hand-written baseline for all 24 scenarios
  before timing anything.
- **The docs e2e suite** exercises real hydration, streaming, routing and sockets in a browser.

Review the snapshot diff line by line. A removal that is genuinely behaviour-preserving produces a diff
you can read in full and account for entirely. If you cannot account for a line, that is the result.

## 5. Deleting is not the only removal

Several of the wins were not deletions:

- **Derive instead of store.** An item's lower bound came from a marker; it now comes from a walk of the
  live sibling chain. One fewer node per row, forever. Derived beat stored because the stored value went
  *stale* — an interpolation that starts empty creates its text node in front of its anchor.
- **Split instead of delete.** Pulling `refreshing` out of `SlotState` removed a field and fixed a
  propagation bug in one move.
- **Emit only what is read.** Two reactive cells per list item became "whichever the binding shape
  actually reads" — the code still exists, it just stops running when nothing consumes it.

"Can this be removed" is the narrow question. The useful one is **"does this need to exist in this
form?"**

## 6. Know what is load-bearing

The mirror of `PERFORMANCE.md` §9. Some code looks redundant and is holding an invariant:

- **Anchors and markers that bound a region** encode hydration-mismatch recovery. `claimBlock` clears
  between them; `requireOpen` verifies them. A block that cannot bound itself cannot recover locally.
- **`run` stamps and generation counters** supersede stale work. `fill`'s per-run stamp is what drops a
  `publish` override that a later fill has overtaken — which is why the identity fix went on `merged`'s
  output rather than on `fill`.
- **Deliberate over-notification.** `pending`/`error` readers waking on a value change is recorded as a
  decision, not an oversight. Over-notifying is safe; under-notifying is not.
- **Loud failure paths.** A `throw` on a missing scope in the bench page looks like dead defensive code.
  It is what stopped the browser bench silently measuring less than it claimed to.

Before removing anything of this shape, find the comment explaining it. If there is none, that is the
first thing to add — and the mechanism, not just the outcome, or the next sweep re-opens the question.

## 7. The ledger, for removal

Same two columns as `PERFORMANCE.md` §7, different contents.

**Cost of keeping:** every future reader pays comprehension; every future change pays maintenance across
the places it touches; a redundant carrier is somewhere a bug can hide (two markers can disagree; a
field can go stale).

**Cost of removing:** the risk that it was load-bearing, scaled by §2's loudness rule; migration if it
is public surface; capability genuinely lost.

Public API is a hard stop. `CLAUDE.md` is the public reference — removing anything it documents is an
ADR conversation, not a sweep.

## 8. Gates

A removal is behaviour-preserving or it is a bug, so the whole suite is the guard, not a subset:

- `bun test` from `packages/abide` — **from the package directory**, or the happy-dom preload is skipped
  and ~236 tests fail spuriously
- `bun run typecheck` — removing a required field makes every construction site a compile error, which
  is the cheapest possible way to find them all
- `bunx biome check`
- `cd packages/docs && bun run e2e:ci` for anything touching emit, runtime, hydration or the reactive core
- `cd packages/bench && bun run bench` — its equivalence assertions cover all 24 scenarios

Review every snapshot change by hand (§4). Never accept `-u` output without reading it.

## 9. Running a hunt

An agent asked to "find code to delete" will find some, confidently, and some of it will be
load-bearing. The contract is what makes the fan-out safe.

### Territories

| territory | files | the question |
|---|---|---|
| emitted SSR output | `ui/internal/emitServer.ts` + its emitted output | what is emitted per node that nothing reads? |
| emitted client output | `ui/internal/emitClient.ts` + its emitted output | per-item cells, params, frames with one job |
| DOM runtime | `ui/internal/runtime.ts` | nodes per item; two things bounding one range |
| reactive core | `shared/internal/reactive.ts` | carriers holding more than one axis |
| memo | `shared/memo.ts` | fields copied forward; envelopes rebuilt to carry one flag |
| server request path | `server/internal/router.ts`, `makeRpc.ts` | per-request work nothing consumes |
| streams | `shared/internal/replayableStream.ts`, `ui/internal/streamScheduler.ts` | retained state no reader observes |
| bench + docs app | `packages/bench`, `packages/docs` | duplicated corpus knowledge, stale scenarios |

Read §6 before proposing anything. Territories overlap `PERFORMANCE.md` §12 on purpose — the same file
answers both questions, and a hunt should pick one question at a time.

### What a finding must carry

1. **Who reads it today**, by name — call sites, not "seems unused".
2. **How the reader gets what it needs afterwards** — derived, or already available elsewhere.
3. **The oracle diff** (§4), read in full and accounted for line by line.
4. **What would fail if this is load-bearing, and whether anything catches it** (§2). A removal whose
   failure is silent and conditional does not proceed regardless of size.
5. **The ledger** (§7) and the verdict that follows.

### Reporting

Per territory: **confirmed removals** (all five above), **examined and load-bearing** — with the reason,
so it becomes a comment rather than a rediscovery — then **unexplored** and why.

The middle category is the most valuable output. "The component anchor pair looks removable and is not,
because `claimBlock` needs it to bound local recovery" is a permanent result; it stopped one sweep and
should stop the next without re-deriving.

Do not implement during a hunt. Findings first, ranked by the ledger; implement afterwards, one at a
time, each through §8. Batched removals are indistinguishable from each other when something breaks.
