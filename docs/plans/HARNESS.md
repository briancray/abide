# The measurement harness

## What this document is

A **plan**. It answers one question: *what produces a number here, and what makes the number
believable?*

Nothing here is decided. The four documents carry what has been decided, and a statement in this
file that turns out to constrain behaviour becomes a clause in RULEBOOK.md — after which this
document cites the number rather than keeping the sentence, because a second copy drifts and only
one of them gets fixed. Where this plan refuses an alternative, the refusal is owed a DECISIONS
entry before the code lands, not after.

Delete this file when the last stage below has landed AND the two questions stage 5 manufactures
are closed — not at the moment one example of sixty-nine is measured, which is what "the last stage"
alone would mean and is a beginning rather than an end. A plan that outlives its work is read as a
description of the code. The two mechanical checks below cover a plan's CITATIONS; nothing
checks a plan's CLAIMS, which is what makes the sentence above a deletion instruction and not a
reassurance.

**This plan is the supply side of the other four.** `REACTIVE.md`, `RENDERER.md`, `SERVER.md` and
`COMPILER.md` name a lane on seventeen lines between them, and each of those lines is an order this
file has to fill. `SERVER.md`'s stage 0 is *"the lane does not exist; nothing else starts until it
does"*, `REACTIVE.md`'s phase 0 writes its vanilla arm into `harness/measure`, and `RENDERER.md`'s
measurement 1 wants `shares()` before a line of the reconcile. So this is not a fourth plan
competing for attention with three others — it is the one they are all blocked behind, and it is
the smallest of the four.

This file added itself to `packages/dogfood/tests/rulebook.test.ts`'s plan list, which is where the
two mechanical checks on a plan live — a citation that resolves to a *withdrawn* clause, and a
proposed RULEBOOK group that already exists. The list is hard-coded, so a plan arriving is the
moment somebody adds it, exactly as `OLD_SHAPE` works for a docs page. Verified by reverting: a
citation of the withdrawn 40.4, planted in the citing half of this file, reported it by name and
took the offender count from 0 to 1. This sentence names the number and survives only because it
also says *withdrawn*, which is the check's one escape hatch and is being used as designed.
(CLAUDE.md said `docs/plans/` was "gated by nothing"; that sentence has been corrected, and now
says what the two checks cover and what they do not.)

The state today: **all six stages have landed.** Five entries exist —
`harness/{measure,engine,server,report,gate}` — and 25 exported names, which is the
machinery number this package answers to and is up from 17: five went to the live reading the panel
renders, and three to the published-counter wire (`PUBLISHED_WORK_KEY`, `PUBLISHED_WORK_FIELDS`) and
to `inAFreshProcess`, which moved out of this package's own tests once it became the invocation every
allocation gate in the framework needs. What has NOT happened is the thing stage 5 was written for: four of
`read-invoice`'s five rows compare an abide arm against a hand-written one, and no abide arm RUNS,
`compiled/` being one emitted module rather than a served page. So one row of one bench flipped to
measured and the producer names the other four every run. **That is why this file is still here.**
The deletion condition at the top is unchanged and is now the only thing between this plan and the
bin: the last stage has landed, and "one example of sixty-nine is measured" has not.

## The decision everything else falls out of

**The harness is an assertion vocabulary before it is a benchmark runner.**

The reading that makes this a benchmarking package is available and wrong. Count what the sibling
plans actually ask for. `SERVER.md` has eleven work gates and says ten of them leave the output
identical — `SERVER.md:1034` is the correction, `:1036` and `:1072` the stale copies it did not
reach, and that is drift to fix there rather than to average here. `REACTIVE.md` has eleven, all of
them. `COMPILER.md` has ten and flags the last two as the ones that fail silently. That is
thirty-two gates, the large majority of which are contracts a correctness test cannot see, against
five benchmark rows in one `example.json`.

RULEBOOK says the same thing from the other end. Twenty-four clauses are **candidates** for
constraining work rather than output — 3.13, 5.1, 5.2, 6.4, 7.3, 8.8, 8.9, 8.10, 9.4, 9.16, 11.5,
11.6, 11.10, 11.18, 11.62, 12.6, 22.7, 22.8, 22.9, 26.2, 39.7, 41.9, 41.12 and 41.14. Most of them
are satisfied by an implementation that produces the right answer while doing the wrong work, so
most of them are owed a counter and none of those is owed a millisecond.

**Candidates, and the rule decides** — CLAUDE.md's framing, and it bites immediately. 3.13 is
already a false positive: `s.success` not moving for a load in flight is *directly observable*, so
it is an ordinary correctness test and not a work gate. That is `SERVER.md`'s "one row moved out of
this table" happening again on the first pass, and the twenty-four owe the same triage before any
of them is filed as a gate. The set below is what the grep returns, not what survives it.

Re-run that set rather than trusting this paragraph; the count was wrong twice while this file was
being written, because the wrapped clauses do not carry their number on the matching line:

```sh
awk '/^[0-9]+\.[0-9]+ /{cur=$1} \
     /MUST (NOT )?(wake|be woken|allocate|retain|recompute|run once|move|coalesce|share one|be rebuilt|be appended|be run a second time|accumulate)/{print cur}' \
     docs/RULEBOOK.md | sort -u
```

So the primary export is a counter you assert an exact integer against, inside `bun test`. The
ratio, the bench table and the `example.json` writer are downstream of it and are the second
product, not the first. A design that starts from `bench()` gets the counters as an afterthought
and gets them undifferentiated, which is the specific failure the node-kind split below exists to
stop.

## What the other four plans have already ordered

This table is the requirement list, and it was read off the plans rather than invented. A row with
no lane named is a demand the plans make that no lane currently answers — which is why the column
is *produced by* rather than *lane*, four of its cells naming something that is not one.

| Ordered by | What | Produced by |
| --- | --- | --- |
| `REACTIVE.md` phase 0 | a hand-written `let value; const subscribers = []` arm, abide-free | `measure` |
| `REACTIVE.md` gates ×11 | wakes, body runs, descents, entry-map size, `Link` allocations | the wake counter + `retained` |
| `REACTIVE.md` | per-write ns at `tail: 4` against `tail: 4096`, within 1.05x | `report` batcher |
| `REACTIVE.md` | the JSC arm under `bun test` AND the V8 arm under playwright — both or neither | `measure`, both substrates |
| `RENDERER.md` | element moves on a two-row swap of 500; bindings per row; nodes per item | `measure` |
| `RENDERER.md` | allocations per row in steady state, including IDL string conversions | `measure`, INFERRED — see below |
| `RENDERER.md` measurement 1 | reconcile as a fraction of click-to-paint, before the reconcile is written | `engine` |
| `RENDERER.md` | redundant `.data` writes per row; document bytes | `measure`, `server` |
| `SERVER.md` stage 0 | allocations per request by JSC type, against a vanilla `Bun.serve` arm | `server` |
| `SERVER.md` | closures per call over n rungs; promises per rung; microtask ticks | `server` |
| `SERVER.md` | bytes retained under a stalled reader | `server` |
| `SERVER.md` measurement 2 | a layer as a fraction of navigation → paint, not of a page request | `engine` |
| `SERVER.md` | TTFB against time-to-first-chunk, batched | `engine` + `report` |
| `COMPILER.md` | checker calls per wave, counted — 1 against 400 | `spyOn`, from `bun:test` |
| `COMPILER.md` | cache hits on an upstream edit, counted | *`COMPILER.md`'s to shape* |
| `COMPILER.md` | build-time µs on bun, batched, run twice, **cold AND warm** | `report` batcher |
| `COMPILER.md` | an IR op-count ratio against the vanilla arm | *nothing — not a DOM call, not a heap type* |
| `SERVER.md` stage 0 | the share of request → last byte, bun-side, no browser | `report`, NOT `engine` |
| `SERVER.md` gates ×6 | handler body once across load AND hydration; memo load ×2; room entry drop; disposer once; record not allocated | `retained` + the wake counter |
| `SERVER.md` measurement 4 | handler time per page load with the seed buffer against without | `report` batcher |
| `REACTIVE.md` phase 0 | the reactive layer's share of one named op, threshold 10% | `engine` |
| `RENDERER.md` measurement 2 | `take` against an inline clone, DOM calls per row | `measure`, needs `cloneNode` |
| `RENDERER.md` | a rotate ratio at the n where it crosses a frame, asserting ELEMENT MOVES | `measure` + `report` |
| all four | the machinery triple: LOC, exported names, branches on a shared path | `report`, two of three unbuilt |
| `coverage.test.ts` | a `vanilla` figure and a `ratio` on every bench row | all three + `report` |

Three things fall out of the table that would not fall out of an API sketch.

**`REACTIVE.md` orders a ratio between two configurations of the same structure** — neither a count
nor an arm-against-arm ratio. It is the retention rule from CLAUDE.md, and it needs the batcher
without needing a lane.

**"Allocations per row, both substrates" cannot mean heap-true allocations.** `RENDERER.md` orders
it from `measure`, in both substrates, and the only allocation instrument that exists is `bun:jsc`
— which is `server`, bun-only, and cannot run in the browser arm at all. So in `measure`,
"allocations" means INFERRED FROM COUNTED CALLS: one `DOMString` per non-string `.data` or
attribute write, one node per `create*` or `cloneNode`. That is available in both substrates and is
exactly what the IDL-conversion row is about — an engine-internal conversion that does not exist
under happy-dom, where `.data` is a plain JS property, and is not a JSC heap object either.
Heap-true counts stay on `server` and are single-substrate by construction.

**Two of the machinery triple have no producer.** CLAUDE.md budgets machinery as LOC over vanilla,
exported names added, and branches added to a shared path; `REACTIVE.md` is explicit that "the
triple IS the budget here, not a supplement to a timing claim", because it takes ms off the table
entirely. This plan homes the LOC counter and nothing else. Exported names are countable off the
built graph — `lanes.test.ts` already runs `Bun.build` for exactly this kind of question — and that
one should land with `report`. Branches on a shared path stays hand-counted, and saying so is
better than the table implying otherwise.

## The lanes, and why there are three

The split is by **dependency**, not by subject matter, and that is what makes it a package rather
than a folder inside the framework. Each lane exists because it can only run in one place:

| Lane | Depends on | Runs in |
| --- | --- | --- |
| `measure` | nothing | bun (over happy-dom) **and** a real browser |
| `engine` | playwright, CDP | the playwright side, chromium only |
| `server` | `bun:jsc` | bun |

`measure` having no abide in its graph is the constraint the whole layout is for: it is what lets
the hand-written arm of a ratio be timed by the same clock and the same batch sizing as the abide
arm. It is already gated, on the resolved graph rather than on the source text.

An engine number is not available inside a case body. That is a property of the lane and not a gap,
and any API that pretends otherwise is inviting a claim about the emulator.

## The fourth entry, which is not a lane

`harness/report` — a dependency-free leaf holding the record shape, the clock, the batcher and
`ratio()`. All three lanes need every one of those, in both substrates, and they ship into the
injectable; CLAUDE.md's seam rule points at the leaf, because the same utility on both sides is the
duplication this layout invites.

**The LOC counter and the `example.json` writer are NOT in it, and the first draft put them there.**
Those two run once, on bun, from a script, and they touch the filesystem — which this plan already
homes elsewhere when it says the producer is a workspace script rather than an `abide` command. A
LOC counter needs `Bun.file`/`Bun.Glob`, so parking it here makes the leaf BUN-ONLY, contradicting
the one property the leaf is justified by, and it collides with CLAUDE.md's import-edge rule: an
edge is priced by the module it lands on, so `measure` importing a clock would drag a `Bun.Glob`
into the module the injectable is built from. They live in `bun run bench`.

The alternative considered was parking the whole thing in `measure`, which is already
dependency-free and would satisfy the strictest constraint automatically. It is refused because it
makes the playwright side import a lane it is not in to get a clock, and because a LOC counter has
no business in a lane that counts DOM calls — an argument that indicts the six-member leaf too,
which is how the two members above came to leave. **The refusal is owed a DECISIONS entry**, and
the entry should say that the cost is a fourth export where the comments in the source say "1 of 3".

`lanes.test.ts` asserts that three entries resolve. It does not forbid a fourth, and the comments
in each lane's header say "Lane N of 3" — those want a line saying the leaf is not a lane, or the
next reader counts four lanes and looks for the fourth question.

## `harness/measure`

Prototype patches, installed ONCE and armed around a case body:

* `Node.prototype`: `insertBefore`, `appendChild`, `removeChild`, `replaceChild`, `cloneNode`, and
  the `textContent` setter
* `ChildNode` on `Element` and `CharacterData`: `remove`, `before`, `after`, `replaceWith`
* `ParentNode` on `Element` and `Document`: `append`, `prepend`, `replaceChildren`
* `Element.prototype`: `setAttribute`, `removeAttribute`, `toggleAttribute`,
  `insertAdjacentElement`, `insertAdjacentHTML`, and the `className` / `innerHTML` / `outerHTML`
  setters
* `CharacterData.prototype`: the `data` setter — `RENDERER.md` orders redundant `.data` writes per
  row
* `Document.prototype`: `createElement`, `createTextNode`, `createComment`, `importNode`
* `EventTarget.prototype`: `addEventListener`

`cloneNode` is on that list because `RENDERER.md`'s line 67 is
`template.parsed.cloneNode(true).firstChild` — every instance and every row in the compiled arm is
made by clone, so a patch set without it reports `nodesCreated: 0` for the whole arm while the
vanilla arm reports 3 per row. That is not a small miscount, it is the ratio upside down. It is
also what `RENDERER.md`'s measurement 2 is entirely about: `take` against an inline clone is a
comparison of two clone strategies, and an uninstrumented `cloneNode` counts neither side.

**The patch set is enumerated from the DOM interfaces, not from the mutators this repo happens to
use, and the two rules that keep it honest are worth more than the list.**

*Patch the interface that OWNS the member.* `textContent` is defined on `Node`, and the first
draft of this list put it on `Element` — where it would intercept an element's write and miss a
text node's, which is `RENDERER.md`'s per-row path. Worse, it would miss it *differently* in the
two substrates: happy-dom defines own `textContent` descriptors on `Element` and `CharacterData`
as well as `Node`, so patching the subclass counts in bun and silently does not in a browser. A
lane whose whole claim is "the only lane in both substrates" cannot have a patch set that resolves
differently in each. **Gate: the installed patch set, listed by interface and member, is
byte-identical in both substrates** — asserted on the list itself, not on a count, because a count
is what goes quietly to zero.

*Installed once, armed per case.* The first draft said "installed and removed around a case
body", which cannot be done in the browser arm at all: `addInitScript` runs at document-start and
has no removal hook, so a patch injected that way is live for the page's whole lifetime and every
`engine` trace on that page would be taken over a patched DOM. Re-patching per case also
invalidates the inline caches on those members once per case, for the process. So the patch lands
once — next to `GlobalRegistrator.register` in the preload, and at document-start in the browser —
and `arm()` / `disarm()` swap the live record for a discard. The prototype shape is then fixed for
the process lifetime, which is the construction rule from CLAUDE.md's hot paths applied one level
up. **Gate: counts land in the discard between cases — reverted to a single always-live record,
case 2 inherits case 1's totals.**

*An unpatched mutator is a THROW, not a zero.* This is the rule the list cannot supply. A reconcile
written with `node.remove()` against a patch set that only knows `removeChild` reports
`elementsMoved: 0`, every `RENDERER.md` gate goes green, and the plan's own warning two sections
down — a gate that reads 0 forever is green forever — has landed in the lane that issues it. So
`measure()` installs a Proxy trap over the mutating members it does NOT count and throws naming the
member, rather than letting an uncounted write through. The list above is then a list of what is
counted; everything else is a loud failure. **Gate: a case body calling an uncounted mutator fails
with that member's name — reverted, it reports 0 and passes.**

*Count the OUTERMOST patched call only.* This is the rule the byte-identical patch set does not
supply, and it is the one that decides whether the both-substrates claim survives. happy-dom
implements aggregate members in JavaScript on top of the same primitives the lane patches; Chromium
implements them in C++ where no JS-visible call happens. Measured: `textContent = ''` on a node with
two children reports **2 `removeChild` calls under happy-dom and 0 under Chromium**. Patch both
members without a re-entrancy guard and one write counts as three things in bun and one thing in a
browser — the patch set is byte-identical, the gate on it passes, and the counts still diverge. So
the record takes the outermost armed call and the nested ones increment nothing. **Gate: a
`textContent` write reports 1 `textContent` write and 0 `removeChild` in both substrates —
reverted, bun reports 2 removals that Chromium never sees.**

Shipped as one built file so `bun test` imports it and playwright injects the same bytes through
`addInitScript({ path })`. Same code, same clock, same batch sizing in both substrates — which is
the only reason the lane is worth having in two places at all.

**The counter must not return an undifferentiated `nodesMoved`.** CLAUDE.md records the case that
settles it: moving a comment is 0.11 µs and moving an element with its subtree is 2.8 µs, 25x,
because only the element is in the reflow — and a marker-elision change worth 998 fewer records
measured at +0.053 ms on one run and −0.033 on the next, under the noise floor, and was dropped. A
single total is exactly the number that made that change look worth writing. So the record
partitions by node kind at the point of counting, and there is no accessor that adds them up:

```ts
const work = measure(() => swapTwoRows())
work.elementsMoved    // 2   — the reflow. RENDERER.md's gate is on this row
work.markersMoved     // 6   — free, reported, and never summed with the row above
work.textMoved        //
work.nodesCreated     // 0   — includes cloneNode, which is how the compiled arm makes every row
work.attributesSet    //     — setAttribute / removeAttribute / toggleAttribute
work.dataWrites       //     — redundant `.data` per row
work.listenersBound   // 0   — addEventListener, and NOT "bindings per row"
work.bindingRuns      // 0   — RENDERER.md's bindings per row, read off the wake counter below
work.wakes            // 0   — effect re-runs. REACTIVE.md's gates are on these two rows
work.descents         // 0   — nodes visited per propagation, REACTIVE.md's 16-against-256
```

There is **no duration field, deliberately**, and `time()` throws while the counters are armed. See
"What must be measured before it lands", item 1: the counter runs inside the path it counts, so a
number that is both a count and a duration is a number taken with the instrument in the arm. The
two are mutually exclusive passes over the same case body, which is a distinction between two
FUNCTIONS and not between two lanes — lanes are partitioned by dependency, and counting and timing
have the same dependencies, so a lane for each would be a lane answering no distinct question.

**`listenersBound` is not "bindings per row", and the first draft said it was.** `RENDERER.md`'s
binding is a compiled reactive slot — `effect([name], () => { greeting.data = … })` — and its gate
is a binding-RUN count going 0 → 2n. `addEventListener` is a different thing that a keyed row does
not call in either arm, so the two rows agree at zero with the mechanism in AND out, which is a
gate green against its own bug. They are separate fields now.

Fixed shape, every field initialized at construction, no closure retained past the call — the
hot-path rules, and they bind here because the counter runs inside the path it is counting.

**Wakes, binding runs and descents are read off a counter abide publishes, not off a DOM patch.**
This is the largest ordered category in the table — eleven `REACTIVE.md` gates, and CLAUDE.md's
"in a reactive system that means asserting WAKE-UPS, not values" — and the first draft filed it
under `measure` + `server` with no instrument at either end. A prototype patch cannot see an effect
re-run, and the lane may not import abide to count one. Two mechanisms were considered and the
split between them is clean rather than a toss-up:

* an **effect body the test itself writes** (`let runs = 0; effect(() => { runs += 1; … })`) needs
  no harness facility at all and no abide import, because the body belongs to the test. It covers
  body runs and it is what most of the eleven want;
* it cannot reach a **descent**. `REACTIVE.md`'s k=8 gate is 16 against 256 nodes visited inside
  `propagated`, which is module-local and not among `graph.ts`'s exports — no object to patch, no
  body to instrument. So abide publishes a fixed-shape record on `globalThis.__ABIDE_WORK__` under a
  dev flag, the harness READS it and zeroes it, and the lane-isolation gate stays green because
  reading a global is not an import edge.

The second buys the first for free and works in both substrates through the same injected bytes, so
it is the one specified. **Gate: `lanes.test.ts` still resolves `measure` with no abide in its
graph — reverted to an import of `graph.ts`, the existing gate fails, which is what it is for.**

**AND THE WIRE NEEDED TWO REFUSALS OF ITS OWN, which the sketch above does not have because it reads
as one mechanism rather than as a protocol between two packages that cannot share a type.** The
address and the field list are now a leaf — `measure/PUBLISHED_WORK.ts`, read by the lane and by the
lane's own tests, where the shape had been transcribed twice and abide would have made a third — and
D113 decides the two ways it can go quiet. ABSENT is `null` on those three rows of `Work` rather than
`0` (44.23): every DOM-only case and the whole hand-written arm publish nothing by construction, so a
throw was not available, and `0` read as "the op woke nobody" about a counter never wired. INCOMPLETE
is a throw naming the field (44.24), and it is the worse of the two rather than the milder — `armCase`
ZEROES all three fields on whatever was published, so a field abide never declared is created there
at 0 and read back at 0. Measured with the check out: a record carrying only `wakes` and
`bindingRuns` reports `descents: 0`, and the k=8 gate of 16 against 256 passes on it.

`REACTIVE.md`'s phase 0 arm lives here too, under `measure/vanilla/`: `let value; const subscribers
= []`, hand-written, no abide, and the one thing every reactive ratio is against.

## `harness/engine`

Its primary export is not a timer. It is a **fraction with a stated denominator**.

"Name the share before changing the layer" is the rule two reactive-core rewrites landed as no-ops
for skipping, and `SERVER.md`'s measurement 2 shows the same error one level up: a layer at 4% of a
request, where the request is 30% of the wait, has a ceiling of 1.2%, and the first draft would
have written down 4%. A denominator that is optional is a denominator somebody omits. So it is
required:

```ts
shares(trace, { layer: 'reconcile', of: 'click-to-paint', threshold: 'frame' })
// → { layer: 0.043, of: 1, ceilingCpu: 0.043, ceilingObserved: 0,
//     threshold: 'frame', op: 'click-to-paint', underOneFrame: true }
```

**`shares`, plural, and it takes the trace.** Two corrections to the first draft, and the second is
the one that mattered. The name is `shares()` in CLAUDE.md, in
`packages/harness/src/engine/index.ts` and in `RENDERER.md`; this file spelled it `share()` in three
places and `shares()` in two, which is one export with two names before a line of it exists. And
every argument in the first sketch was a NAME while every returned value was a MEASUREMENT — nothing
in the signature carried a trace, a duration or a sample, so the fractions were supplied by the
author. That makes "name the share before changing the layer" spellable without measuring anything,
in the one lane whose whole point is the denominator. The trace is the first argument and the
fractions are read out of it.

`threshold` is a required PARAMETER — the first draft listed it as "the second required argument"
and then showed it only in the return, which is the same defect in miniature. It is required
because "the expectation is that this layer is a few percent" is a prediction and gives nobody a
reason to stop; a frame (~16 ms) or an interaction budget (~100 ms) is a threshold and does.

**Two ceilings, because a CPU share is not a latency.** The first draft returned one `ceiling` and
called it "what gets written down", which quotes a fraction of CPU time as though removing it
removes wall clock. Three paragraphs later the same section says click → paint is frame-quantised —
and removing 4.3% of an op that is going to be rounded up to the next frame boundary changes
observed latency by exactly zero. CLAUDE.md is explicit that cpu is for seeing which way the
headroom runs and is never quoted as latency. So `ceilingCpu` is the fraction and `ceilingObserved`
is what a user would experience, which is **0 whenever `of` is under one frame**. The second is the
number that stops a rewrite, and it is the one the first draft could not express.

**The numerator needs an attribution mechanism, and it is user timing.** "Reconcile" is not a Blink
layer — style, layout and paint are, and a reconcile is application JS. Attributing it out of a CDP
trace means either `performance.mark`/`measure` pairs emitted by the code under test, or the
sampling profiler, and the sampler at ~1 ms cannot resolve a layer inside a 1.45 ms op. So the code
under test emits the marks, `shares()` reads them out of the trace, and containment becomes
CHECKABLE rather than assumed: `layer.start >= of.start && layer.end <= of.end`, asserted, which is
the assumption the withdrawn `within` violated silently. A `layer` that also runs outside `of` — a
second flush, an idle pass — is a throw and not a smaller fraction.

**`within` is withdrawn, and the reason is a category error worth recording.** It was there to
compose — `{ of: 'click-to-paint', within: 'navigation-to-paint' }`, multiplying to a `ceiling`. But
the reconcile does not run inside navigation → paint; hydration does. Click → paint is an
INTERACTION op and navigation → paint is a FIRST-LOAD op, and multiplying a fraction of one by a
fraction of the other produces a number describing no op at all. Composition is only sound down a
nesting chain, and there are two chains here that never meet:

* **first load** — navigation → paint ⊃ request → last byte ⊃ the server's layers, the SSR emit,
  hydration;
* **interaction** — click → paint ⊃ the reconcile ⊃ the graph walk.

So `shares()` composes only where the caller passes one trace and the ops nest within it, and the
lane refuses a `within` naming an op the `of` is not inside. The consequence for the four plans is
that their budgets do not add up to one number, by construction: a first-load ceiling and an
interaction ceiling are separate numbers and neither bounds the other.

Beside it, `RecalcStyleCount`, `LayoutCount`, **`PaintCount` and forced-layout count** per op — all
four, because CLAUDE.md's engine lane is "style, layout, paint, forced layout" and the first draft
of this section kept two. Forced layout is what the rule about a layout read after a write in the
same path is asserted with — "one such read per row is the whole frame" — and paint is the other
half of "9,102 nodes moved against 954 painted in the same single frame". Not for pricing, but so
that two arms **report the work** rather than only ms. That counter set exists because of the
recorded case where byte-identical page source ran 4.5x apart and the only difference was that one
arm shipped a stylesheet: the faster arm was not doing the work at all. An existence proof is
believed after the counters agree, not before.

And the lane says out loud what it cannot resolve. Click → paint is frame-quantised: nine ops
reading 16.6–17.0 across six frameworks is the answer, not an instrument problem. A duration under
one frame comes back tagged `underOneFrame` rather than as a ratio, and the bench writer renders
the tag. Otherwise every card publishes noise as a claim, and `read-invoice`'s "First paint 16.8 ms
/ 16.7 ms / 1.01x" is that row already written by hand.

## `harness/server`

`SERVER.md` has already specified this one and estimates ~40 lines for everything it quotes:
`heapStats`, `fullGC`, `heapSize` and `estimateShallowMemoryUsageOf`, with
`heapStats().objectTypeCounts` after a `fullGC` for per-type counts — a field of the record, not a
fifth export, and a re-queueing probe for microtask ticks.

Two findings from that section belong in the API rather than in a comment, because both are traps
that pass:

* **JSC counts a plain class instance as `Object`.** A gate written against `objectTypeCounts.Scope`
  reads 0 forever and is green. So the surface returns a type-count diff and never invites naming
  your own class. It returns the **whole diff** — the first draft filtered to seven JSC-visible
  types (`URL`, `Function`, `JSLexicalEnvironment`, `Map`, `Array`, `Promise`, `Response`) and that
  is the same trap approached from the other side: `Object` is not on that list, and `Object` is
  exactly where `Scope` and `Call` land, at `Object:6.09` the largest single line in `SERVER.md`'s
  breakdown. `string` is absent too, and `RENDERER.md`'s IDL-conversion row needs it. A filter is a
  second way to read 0 forever. The finding is a note, not a filter.
* **Closures are `Function` + `JSLexicalEnvironment`**, and that pair is `SERVER.md`'s onion gate —
  0 closures per call over n rungs, reverting to `Function:5 JSLexicalEnvironment:5` at n=5. It gets
  its own named export so nobody re-derives the pair. Confirmed under bun 1.4.2: after a `fullGC`,
  five closures move the pair by exactly +5/+5, and `Scope` never appears as a key at all.

**`retained()` and `allocated()`, because `heapStats()` cannot see an allocation.** This is the
correction that matters most in this section, and the first draft filed it as variance under "what
must be measured". It is not variance, it is the mechanism: `heapStats()` after a `fullGC()` can
only count what is still REACHABLE. Measured, the same 2000-rep `new URL()` batch six times over —
with the results held in an outer array, **2000 every run, exactly**; with them held in a
block-scoped local, **2002, 2000, 2000, 0**. Run 3 did not lose them to GC nondeterminism; JSC saw
the local was never read after the loop and collected it before the `after` read. So whether a gate
observes the allocation it gates depends on the optimiser's liveness analysis of the case body
somebody wrote, invisible at the call site, and it flips when the body is edited for an unrelated
reason. `SERVER.md`'s fractional `Object:3.09` is that instability, not a genuinely fractional
quantity.

The split is a rename plus a tag, and it retires an open item rather than scheduling one:

* `retained(fn)` — exact, integer-gateable, and it is what every one of `SERVER.md`'s allocation
  gates actually asserts. The onion gate is about closures the composed onion HOLDS;
* `allocated(fn)` — a batch mean only, returned tagged so it can never be compared with an exact
  integer, and reported with its rep count.

**And allocation gates run in a process with no DOM.** `bunfig.toml` preloads happy-dom into every
`bun test` process, and since JSC buckets plain class instances as `Object`, happy-dom's own
implementation objects land in the same untyped bucket as the framework's — so "the gate is on the
total" is worthless for any op that touches the DOM, and there is no DOM-free bun test process in
this repo today. `retained()` asserts `typeof document === 'undefined'` at entry and throws, and
the allocation gates get their own preload-free invocation. Cheap, and it converts a silent
contamination into a failure.

`bytes(response)` covers the document, the built bundle per entry, and bytes retained under a
stalled reader — the last of which is `SERVER.md`'s backpressure gate, filed there because
"allocates no queue" is not directly observable and the retention is.

**`calls()` is withdrawn: `bun:test` already ships it.** The table found call counting ordered
twice and homed nowhere, and the conclusion drawn from that was a new export. It was homed all
along — `spyOn(checker, 'check').mock.calls.length` is `COMPILER.md`'s wave gate (1 against 400)
exactly, with `mockRestore` for the teardown, verified. A `calls()` on `server` would be a rename
with a worse restore story, and it was the one item here whose justification was topological ("it
is bun-side") rather than functional. Withdrawing it also settles the open question about a worker,
identically and for both: a counter in the wrong process counts nothing, whichever name it has.

One of the two gates is not a call count and should stop being described as one.
`COMPILER.md`'s cache gate is "an upstream edit moving no answer produces a cache hit, counted" —
an internal event of the answer table, not a function invocation, unless the cache is shaped as a
method for the counter's benefit. That is `COMPILER.md`'s to spell, and this plan should stop
implying it is free.

## The gate, as a mechanism

CLAUDE.md records three tests written after a change that passed with the bug still in place, and
every sibling plan ends with a variant of "every gate gets the revert". `REACTIVE.md` has already
taken the next step on its own: its gates table carries a third column, *"What it reports with the
mechanism out"*, filled for all eleven rows. That column is the design, and the harness's job is to
stop it being a convention that only one plan follows.

```ts
gate('0 closures per call over 5 rungs (16.15)', {
    revert: () => foldTheChainPerCall(),
    worth: { Function: 5, JSLexicalEnvironment: 5 },
}, () => {
    expect(retained(() => callFiveRungs())).toMatchObject({ Function: 0, JSLexicalEnvironment: 0 })
})
```

**Two fields, and an ordinary test body.** The first draft had four — `revert` and `worth` as
strings, plus `run` and `is` — and `run`/`is` are withdrawn for three reasons. The sketch that
carried them did not typecheck against its own API: `closures()` exists precisely because the
answer is a PAIR that nobody should re-derive, and a pair cannot be compared against `is: 0`. An
exact integer cannot express a meaningful minority of the thirty-two — `SERVER.md`'s "≤1 promise
per call" and "no more than the ring", `REACTIVE.md`'s "within 1.05x", `RENDERER.md`'s 1.05x floor,
and the `underOneFrame` tag are none of them integers. And absorbing the assertion into a field
costs the stack: the failure reads `expect(received).toBe(expected)` from inside the wrapper rather
than from the line making the claim, against CLAUDE.md's "maintain high visibility into the stack",
with nowhere to put setup, teardown, an `await` or a second assertion. An ordinary body has all of
that and `expect` already does the comparison.

**`worth` is RUNNABLE, and that is the upgrade.** As a string it is a note to the next reader. As
`revert` — a function installing the broken arm — plus `worth` — what that arm must report — the
harness can run the revert under a flag and assert the gate FAILS, and fails with that number.
CLAUDE.md's "a gate is verified by reverting the fix and watching it fail" stops being a habit
three tests were written in violation of, and becomes the mechanism. It also answers a rule the
first draft dropped entirely: **a benchmark case earns its place by DISTINGUISHING
implementations**, and a case reporting the same number with the mechanism out is a case that
distinguishes nothing — which the harness can now say, rather than a reader noticing.

**`gate()` is the bun-side vocabulary, and that is a stated cost rather than an oversight.** An
engine number is not available inside a case body — this document says so two sections up — so
`gate()` structurally cannot wrap an engine assertion, which is why stage 4 puts it after the two
lanes whose gates it can wrap. `RENDERER.md` measurement 1 and `SERVER.md` measurement 2 are both
engine gates, and under this design they stay a playwright-side convention with no `worth` field and
no test requiring one. Either they get their own shape on the playwright side or they get none; this
plan does not decide it, and the cost of not deciding is that the third column `REACTIVE.md`
invented does not reach the lane whose numbers are hardest to re-take.

That is also what settles the wrapper against the alternative. **The cheaper variant is a lint over
`test()` names plus a comment convention, and the first draft refused it on a claim that is
false**: "a comment is not a field and no test can require one". A test can absolutely require a
comment — `rulebook.test.ts` and `coverage.test.ts` are most of two thousand lines of tests that
require things of prose, and `citedClauses()` parses free text line by line. A `// revert:` line
above every `test(` in a `*.gates.test.ts` is the same check written the same way. The wrapper wins
on the honest argument instead: a comment cannot be EXECUTED, so a lint can require the revert to
be described and only the wrapper can require it to work.

## What the harness refuses

Each refusal corresponds to a mistake the working notes record having actually been made, which is
the argument for putting the guard in the tool rather than in prose.

1. **A cross-substrate ratio.** The same graph reads 1.67x a hand-written signal under JSC and 0.21x
   under V8 — inverted, not scaled. A `Sample` carries its substrate and `ratio()` throws when the
   two arms disagree. `REACTIVE.md` phase 0 already orders both arms or neither.
2. **A single run, and a floor that was guessed rather than measured.** One run cannot tell 0.4%
   from zero. But "two runs, and if the arms swap it is `underTheFloor`" is a sign test at n=2: it
   misses noise half the time by construction, which is a 50% false-negative rate on the verdict
   protecting every published card. The floor is MEASURED instead, and the mechanism is an **A/A
   control** — run one arm twice, labelled as two arms, and whatever ratio that produces IS the
   floor for that case on that machine that day. `underTheFloor` then means `|ratio − 1|` inside the
   A/A spread, which is a number with a provenance rather than a word. Around it: arms
   **interleaved** A/B/A/B and never in blocks, because JSC tiers LLInt → Baseline → DFG → FTL and
   whichever arm runs second inherits warmed code — a systematic bias, not noise; **warm-up reps
   discarded** with the count on the `Sample`; **`fullGC()` between arms** so GC debt is not carried
   across the interleave; **min-of-n** as the point estimate, since timing noise is
   one-sided-positive and the minimum is the robust estimator and is free; and **p95 reported beside
   it** for anything measured against a frame or an interaction budget, because a mean of 14 ms with
   a p99 of 40 ms is jank published as smooth.
3. **An unbatched sub-millisecond sample.** Browsers coarsen `performance.now()` to 100 µs and every
   arm reading 0.000 or 0.100 is the tell. The batcher asserts the sample is ≥100x the clock's
   resolution and throws rather than returning the clock — with the resolution **measured once per
   substrate** rather than assumed. It is not introspectable and the two substrates are nowhere near
   each other: measured here, `performance.now()`'s minimum non-zero delta under bun is **41 ns**,
   so the 100 µs browser figure over-batches by ~2400x, and a cross-origin-isolated page is 5 µs, a
   20x error the other way. `Bun.nanoseconds()` is the bun-side clock. The batcher GROWS n until the
   sample clears the bar and records the n it used, which must then be equal across arms — a per-op
   figure at n=10,000 has different GC and cache behaviour than at n=10.
4. **A duration whose op touched an emulated DOM.** happy-dom can produce a count; it cannot produce
   a millisecond anybody should quote. The first draft wrote this predicate as *"a `Sample` from the
   bun substrate with unit `ms`"*, which is the wrong axis twice: it refuses three of this plan's
   own orders (`COMPILER.md`'s build-time µs, `SERVER.md`'s TTFB and its measurement 4, all
   durations from bun with no DOM in them) and it lets `REACTIVE.md`'s `tail` ratio through on the
   technicality that its unit is spelled `ns` — a refusal you defeat by changing a unit string is
   not a refusal. The `Sample` carries `emulated: 'dom' | null`, set by the lane, and the refusal is
   on that. A build has no DOM and is permitted; the JSC/V8 inversion still applies to it, but that
   is refusal 1's job and its answer is the ordinary one — the number is a ratio against another
   build in the same engine, or it is not quoted.
5. **A timing sample taken in a parallel worker.** `bun run test` is `--parallel`, and CLAUDE.md
   already knows what that does to a ratio: two cases price one and a loaded machine ties two
   arrivals a quiet one separates, hence `test:serial`. Eight workers competing for cores measures
   the scheduler, and with a measured A/A floor the floor goes so wide under contention that every
   real regression reads as `underTheFloor` — a gate that stops gating without failing. The batcher
   detects a worker and throws, naming `test:serial`. Counts are contention-immune and stay in the
   parallel gate, which is where the count/time split earns its keep a second time: **counts run in
   `bun test`, anything with a clock runs in `bun run bench`.** That line falls straight out of this
   document's opening decision and is what makes it structural rather than rhetorical.

Refusals 4 and 5 are the ones that will be argued with, because both make a convenient number
unavailable. That is what they are for.

**`ratio()` refuses more than a substrate mismatch, and the record is what makes that cheap.** A
`Sample` carries `{ arm, case, n, substrate, emulated, reps, work }`, all required, and `ratio()`
throws on unequal `case`, unequal `n`, the same `arm` twice, or a substrate mismatch — the third
being the failure `lanes.test.ts`'s own comment names, "every ratio in the repo would be measuring
one arm against itself". `ratio()` also returns a DISCRIMINATED result — `{ kind: 'ratio', value }`,
`{ kind: 'underOneFrame' }` or `{ kind: 'underTheFloor' }` — so a tag cannot be stringified into a
numeric cell by the bench writer. The first draft tagged the sample and then said nothing about
what `ratio()` does with a tagged operand, which drops the tag at exactly the call that matters:
two `underOneFrame` samples would divide to `1.01x` and publish noise as a claim. That is
`read-invoice`'s hand-typed First paint row, and a producer that recreated it would have been the
plan's own worked example of the thing it refuses. And it FLAGS when the two arms' `work` counters
disagree by more than a stated factor, which is the recorded stylesheet case — byte-identical page
source, 4.5x apart, one arm shipping a stylesheet and therefore not doing the work at all — turned
from a war story into a field. An existence proof is believed after the counters agree, not before,
and that sentence was prose in the first draft with nothing wired to it.

## Closing the AUTHORED loop

`coverage.test.ts` gates two things about every `example.json`: that every bench row has a
`vanilla` figure and a `ratio` beside it, and that `bench.note` says whether it was measured. The
comment on the second says a bench is authored *"until the harness can produce one"*. There are
sixty-nine example directories and one of them carries a bench today, four of its five rows
hand-typed and Lines of Code counted.

The producer fills those five rows:

| Row | Lane |
| --- | --- |
| First paint | `engine`, tagged `underOneFrame` where it is |
| DOM nodes moved | `measure`, partitioned — the row is `elementsMoved` |
| Style recalcs | `engine` |
| Client bytes | `server` |
| Lines of code | **none** — a static count, in `report` |

Lines of code being homed nowhere is not an oversight; `read-invoice`'s own note already calls it
"THE EXCEPTION", counted from two arms, code lines only. It is independent support for the leaf:
it is a number the bench table needs and no lane can produce.

**The producer is a workspace script, not an `abide` command.** `abide <cmd>` is governed surface —
RULEBOOK 38 and REGISTRY's Commands section — so a bench subcommand would owe a clause, a registry
row and a decisions entry, for a tool no app author runs. `bun run bench <example>` writes the rows
back and replaces `bench.note` with the substrate, the run count and the date. The existing check
keeps passing unchanged **on the note**, which is still non-empty and now names a run. It does NOT
keep passing on the ratio: `coverage.test.ts:885` requires a `ratio` on every row, truthily, and a
First paint tagged `underOneFrame` has none — so the producer's first run turns the suite red on
the one row this section is about. The check has to learn the tag in the same change, and while it
is being touched it should stop accepting any truthy string, which is what let `read-invoice`'s
hand-typed "1.01x" through in the first place.

## What it costs

**PROJECTED, not measured.** Nothing below has been run. A row with a measured number replaces its
projection and says which lane produced it.

**MEASURED, by `bun run bench`, 2026-09-10.** Code lines only, which is the same rule the bench
table's own Lines of code row is counted by.

| | Projected | Measured |
| --- | --- | --- |
| LOC, `report` | ~110 | **261** — record, clock, batcher, ratio, the A/A floor |
| LOC, `measure` | ~210 | **441** — the patches, the re-entrancy guard, the record, the injectable, the vanilla signal arm |
| LOC, `engine` | ~150 | **184** — the CDP session, the four counters, `shares()` |
| LOC, `server` | ~75 with `bytes` | **120** |
| LOC, `gate` | not projected — it had no home | **42** |
| LOC, `bun run bench` | ~70 | **165** — the LOC counter, the exported-name counter, the writer |
| exported names, whole package | **~11** across four entries | **17** across five |
| overhead per counted DOM call | irrelevant by construction | unchanged — there is no duration field |

Every projection is low, `report` and `measure` by more than 2x, and the two reasons are worth
separating. `report` grew because the refusals are five throws with the reason in the message
rather than five predicates. `measure` grew because the patch declaration is 56 rows and the
resolution rule is not one line: happy-dom puts own `textContent` descriptors on `Element` and
`CharacterData` as well as `Node`, and its `Document` prototype is not `globalThis.Document`'s at
all, so a member is resolved from a live INSTANCE by interface name rather than off the global.
The fifth entry is the honest overrun: `gate()` needed `bun:test` and the leaf is justified by
having no dependency, so it could not go there.

There is no vanilla arm for the harness itself and there should not be one. The thing it is
budgeted against is the alternative of not having it, which is thirty-two gates asserted by reading.
That is D111 now.

## The harness's own work gates

The tool that asserts work is a tool whose own bugs are silent, and it gets the same discipline it
imposes.

| Asserts | Revert that must break it | What it reports with the mechanism out |
| --- | --- | --- |
| a known-n mutation counts exactly n | count in the wrapper before the call rather than after a throw check | n → n+1 on a throwing mutation |
| moving a comment and moving an element land in different fields | one `nodesMoved` total | 2 fields → 1, and the 25x case becomes invisible |
| the batcher throws on a sample under 100x the clock | return the sample anyway | a throw → 0.100 quoted as a result |
| `ratio()` throws across substrates | compare the numbers | a throw → 1.67x and 0.21x averaged |
| counts land in the discard between cases | one always-live record | case 2 inherits case 1's totals |
| an uncounted mutator throws rather than reporting 0 | let it through | a throw → `elementsMoved: 0` and every RENDERER gate green |
| a `textContent` write counts identically in both substrates | drop the outermost-only guard | 1 → 3 under bun, 1 under chromium, measured |
| `time()` throws while the counters are armed | return the duration | a throw → a patched-DOM ms quoted as a result |
| `retained()` throws in a process with a DOM | let it run | a throw → totals that move with happy-dom's own objects |
| the batcher throws in a parallel worker | take the sample | a throw → a ratio priced against seven other workers |
| `ratio()` refuses two samples with the same `arm` | compare them | a throw → an arm measured against itself |

The last four are the ones that would be green on their first run, so each names a divergence to
inject rather than an assertion. The `textContent` row is not one of them: the divergence is real,
it is measured above, and the revert reproduces it.

## What must be measured before it lands

1. **~~The counter's own overhead.~~ WITHDRAWN as a measurement, replaced by an interlock.** The
   first draft made this the one number to take before anything else is believed — a case body's
   duration with the patches installed against without, on the 500-row reorder. Three things are
   wrong with it. The substrate was unnamed and the convenient one guarantees the wrong answer:
   measured under happy-dom, interleaved and warmed, min-of-7, the PATCHED arm came out **faster**
   (0.89x), because `appendChild` there is ~130 ns of JavaScript and a JS wrapper is a rounding
   error on it — where in Chromium the same member is native and a patch both adds a frame and
   deoptimises the call site. The denominator was the most favourable op available, an op CLAUDE.md
   records as 52% reflow, diluting the thing being priced by 2x before starting. And it is a
   duration from the emulator, which refusal 4 bans — the plan's own first measurement violated its
   own fourth refusal. Overhead is irrelevant to a count and fatal to a duration, so the answer is
   not a threshold but the interlock in `harness/measure`: no duration field, and `time()` throws
   while the counters are armed. A module-level `ARMED` flag makes it checkable in one line and it
   gets its own revert row.
2. **~~Whether happy-dom's prototypes are patchable the same way as a browser's.~~ ANSWERED, and
   the answer is that they are not, which changed the design.** happy-dom's `Document` prototype is
   not `globalThis.Document.prototype` — `document`'s chain is HTMLDocument → HTMLDocument →
   Document → Node → EventTarget, and `createElement` is own on the third of those — while
   `Element.prototype` and `Text.prototype` ARE the globals. `Element.setHTMLUnsafe`,
   `Document.writeln` and a global `DOMTokenList` do not exist there at all. So a member is
   resolved from a live INSTANCE by walking to the prototype whose constructor carries the declared
   interface name, and a member the substrate does not have is a throw at install rather than a
   skip. The counting half is gated: three shared case bodies, `replaceChildren`, `append`,
   `cloneNode` and the `textContent` write among them, compared count-for-count.
3. **~~`objectTypeCounts` stability across `fullGC`.~~ ANSWERED, and it was not variance.** The
   fractional `Object:3.09` is reachability, not noise — see `retained()` and `allocated()` above,
   where the probe is. What remains is narrower and worth doing: a non-integer per-rep count means
   the allocation is conditional or amortised (a rehash, an IC transition, a once-per-batch
   structure), and a mean hides which. `allocated()` asserting ZERO GROWTH across a batch — the
   first-500 mean against the last-500 — is the leak check the fractional number is actually good
   for.
4. **CDP trace volume on a 500-row op.** `shares()` reads per-layer durations out of a trace, and
   whether the trace itself perturbs the op it is tracing is the engine lane's version of the
   question item 1 withdrew — and it does NOT get item 1's answer, because a trace cannot be
   interlocked away: the engine lane's whole product is a duration, so if tracing perturbs the op
   there is no counting-only pass to fall back to. This is the one instrument-perturbation question
   that stays open.

## What the docs owe

**PAID.** Every item below has landed, and the first paragraph of this section was wrong about the
one that mattered.

**RULEBOOK: a free-standing group, not nothing.** The argument for *nothing* rested on the harness
not being the framework's surface and on a checkable rule belonging in a test — both true, and
neither settles it, because DECISIONS format rule 2 refuses an entry citing no clause and that
check is gated at `rulebook.test.ts`. Eleven refusals with nowhere to hang meant either eleven
entries that cannot be filed or eleven refusals that evaporate when this file is deleted. Format
rule 6 already carries the escape hatch the documentation system uses, so **44. The measurement
harness** declares itself FREE-STANDING and twenty-two clauses hang off it. It took 44 rather than
43: `COMPILER.md` proposes `# 43. Type-directed lowering`, and the collision check exists for
exactly that.

The candidate amendment named here is **untouched**: 40.3 still has an example *SHOULD* carry a
bench, and whether that becomes MUST is a real question the producer does not settle — one row of
one bench is measured.

**REGISTRY: nothing, as written.** No name here is one an app author writes.

**DECISIONS: D101 through D112.** Eleven were owed and a twelfth arrived with stage 5 — the bench
note going per row, which this plan manufactured rather than inherited. Each names its refused
alternative; four carry an `Assumes:`; D107 is marked *contested* in place, which is what that
section asked for.

**CLAUDE.md.** Three statements moved, and two more were added rather than moved. `docs/plans/` no
longer reads as gated by nothing and now says what the two checks cover and what they do not; the
THREE LANES bullet says the leaf is not a lane and neither is `harness/gate`; the seams bullet says
five entries, three lanes. Added: the count/time split — counts in `bun test`, anything with a
clock in `bun run bench` — and the runnable revert. `packages/harness/package.json`'s description
names the leaf, and each entry's header says which of five it is.

## Stages

**All six have landed.** Each was gated by the one before it, and the ordering was the sibling
plans' rather than this one's. What each turned out to cost, and what it turned out to be, is
below — the projection each was written against is in "What it costs".

0. **`report`.** Landed. The `Sample` record, the clock with its measured resolution (41 ns under
   bun), the batcher, the A/A floor, `ratio()`, and the five refusals. Every refusal has a test
   and every test was verified by reverting: with the sample bar out, an empty body at n=1 comes
   back as 0 ns and n never grows; with the `underOneFrame` tag dropped at the division, 16.8 ms
   against 16.7 ms comes back as 1.01x, which is `read-invoice`'s hand-typed row reproduced by the
   producer that exists to refuse it.
1. **`engine`.** Landed. `shares()` is a PURE function of a `Trace` and is gated in `bun test`;
   the CDP driver is gated in `packages/harness/e2e/engine.spec.ts`, against chromium, on a page
   that carries a rule the class it toggles actually matches. Two findings from building it:
   `Performance.getMetrics` gives `RecalcStyleCount` and `LayoutCount` directly, and forced layout
   needs the `disabled-by-default-devtools.timeline.stack` category — without it the counter reads
   0 against four forced layouts in the trace and is green forever. Measured that way first.
2. **`server`.** Landed. `retained`, `allocated`, `closures`, `ticks`, `bytes`. `retained()` roots
   what the body handed back in a module-level slot rather than a local, which is the 2002/2000/
   2000/0 instability removed rather than documented. The `objectTypeCounts.Scope` trap is
   asserted AS a trap: 500 class instances land in `Object` and `Scope` is never a key.
3. **`measure`.** Landed, and the largest overrun. The patch declaration is 56 rows across eight
   interfaces, and the resolution rule is the part no sketch predicted — happy-dom's `Document`
   prototype is not `globalThis.Document.prototype`, and it puts own `textContent` descriptors on
   `Element` and `CharacterData` as well as `Node` — so a member is resolved from a live INSTANCE
   by interface name. The both-substrates gate compares the two installed lists and the counts for
   three shared case bodies, and the bun half is taken by spawning bun from the playwright side
   rather than transcribed. Reverted: with the re-entrancy guard out, happy-dom's own
   `textContent` implementation reaches `createElementNS`, which the refused list throws on — the
   bun arm cannot even complete the case, let alone report chromium's number.
4. **`gate()`.** Landed as a fifth entry, `harness/gate`, because it needs `bun:test` and the leaf
   is justified by having no dependency. `bun run test:gates` runs the reverts. Its own tests are
   the ones that matter: a gate whose revert leaves it passing is reported, and so is a gate that
   fails with a number other than the one its revert is worth.
5. **The bench producer.** Landed as `bun run bench <example>`, with the LOC and exported-name
   counters. The LOC counter reproduces `read-invoice`'s hand-typed 13/26/0.50x exactly, which is
   the closest thing to a validation a static counter gets. `coverage.test.ts` learned the tags,
   stopped accepting any truthy ratio string, and gained a third check that a MEASURED row states
   the ratio its own two figures make.

**What did NOT land, and it is the point of the deletion condition.** Four of `read-invoice`'s five
rows need a served abide arm and there is none, so they stay authored and the producer names them
every run. The harness's own browser gates now run: `webServer` is whole-run rather than
per-project in playwright, so registering them beside the dogfood projects made them wait on
`abide start` — which throws "not implemented" — and they moved to `playwright.harness.config.ts`
under `bun run e2e:harness`, which needs no server at all because `page.setContent` is the page.
`bun run e2e` itself still cannot run, for that same unrelated reason.

## Still undecided

Four bullets that stood here have been decided and are gone: **whether `measure` can be one lane**
(yes — the split is counting against timing, which is two functions with identical dependencies and
therefore not a lane split); **where `calls()` lives in a worker** (nowhere, it is withdrawn for
`spyOn`, D109); **what a `Sample` from a build is** (a permitted bun-substrate duration, refusal 4
being predicated on an emulated DOM rather than on the runtime); and **whether the retention ratio
is exempt from refusal 1** (it never trips it).

Two more closed while stage 5 landed. **How a bench row that has never been measured is spelled**
— the note goes PER ROW and the producer writes a row only when both arms produced a number, which
is D112 and 44.20/44.21; refusing the partial flip would have left the one row that CAN be produced
hand-typed indefinitely. **Whether the bench note's format becomes a clause** — it did, 44.20, and
`coverage.test.ts` checks the two spellings.

What is left:

* **Whether `gate()`'s runnable `revert` runs in CI or on demand.** Implemented as opt-in —
  `HARNESS_VERIFY_GATES=1`, wired to `bun run test:gates` — which is the obvious answer and is
  still not obviously right. There is one gate carrying a runnable revert today and the rest are
  structural, so the cost of running them all is currently nothing; the question re-opens the first
  time a revert is expensive.
* **Whether the harness's own structural reverts can be made runnable.** `gate()` wants a broken
  arm the test can INSTALL, and most of this package's mechanisms are module-level: a depth guard,
  a record shape fixed at construction, a patch installed once for the process. Their reverts are
  comments with the number each reports, verified by hand once. Adding a switch to make them
  installable is a flag with one live value in production, which this repo bans — so either
  `gate()` is for the framework's gates and this is fine, or something else is needed here.
* **How the reactive read/write ratio gets measured.** Still unmeasured, but it is now a one-line
  edit in a named place rather than a design question. CLAUDE.md says which of the three retention
  variants is correct is decided by the read/write ratio, `REACTIVE.md` carries the same trichotomy
  and names no producer, and nothing here measures one. It is the same global-counter mechanism as
  the wake counter, and the counter is now a leaf: two more entries in
  `PUBLISHED_WORK_FIELDS` and two more rows on `Work`, and 44.24 makes abide failing to publish them
  a throw rather than a pair of zeroes.
* **What the dev flag publishing the counter is called.** Undecided, and it is abide's to name rather
  than this document's — 44.25 pins the ADDRESS and the shape, and says nothing about what turns
  publication on. The framework has no flags yet, so there is nothing to be uniform with; the first
  one to land decides it.
* **An identity-stability counter.** Unchanged, and still in no plan's gate table. Distinct
  identities produced per N writes catches both directions of CLAUDE.md's mirror-image reactive
  traps and is three lines.
* **CDP trace volume on a 500-row op.** Still the one instrument-perturbation question that stays
  open, and it did not get any easier: the engine lane's whole product is a duration, so there is
  no counting-only pass to fall back to. Nothing here has been run at 500 rows.
