# abide - isomorphic type-safe framework for reactive async interfaces for humans and machines built on bun and web standards

# documents

four documents carry what has been DECIDED, each answering one question, and a statement in the
wrong one is the drift they exist to stop. this file is a fifth and it answers a different
question — how to WORK here. the other four are about the product.

* `docs/REGISTRY.md` — every name an app author can write, its signature, one sentence of what it
IS, and the clauses that govern it. behaviour is cited, never described.
* `docs/RULEBOOK.md` — every rule, numbered, stated ONCE. anything that needs a rule cites its
number rather than restating it, because a second copy drifts and only one of them gets fixed.
* `docs/DECISIONS.md` — every road not taken, naming the alternative it refused and the clauses it
decided. a reason a MAINTAINER needs; a reason a USER needs is a guide's.
* `docs/BRAND.md` — positioning, voice, vocabulary, visual identity.

CONVERTING A PAGE TO THE CARD SHAPE has a skill — `.claude/skills/convert-docs-page` — and
`OLD_SHAPE` in `packages/dogfood/tests/coverage.test.ts` is what was the backlog. IT IS EMPTY: the
conversion is done and the set is now a RATCHET, so a page arriving in the old shape has to add its
own slug and that is the moment somebody notices. A new page is matched against a CONVERTED one —
any of them, `derive-a-value-from-other-values` being the worked case the skill carries. The
clauses say what must hold and a worked page says what it looks like, which is the part sixteen
clauses across three documents do not carry.

BEFORE WRITING A DOCUMENTATION PAGE, read RULEBOOK 40 and BRAND. 40 is the docs system — one
example per BEHAVIOUR TAUGHT (40.23, 40.24), what a `{% snippet %}` guarantees (40.8-40.12), and
what a panel earns (40.13, 40.14) —
and BRAND is the voice, the vocabulary, and the register of a title against a nav label. both bind
today, where most of the rulebook describes a design nothing can run yet.

BEFORE DECIDING BEHAVIOUR, grep RULEBOOK for a clause rather than inventing one. deciding new
behaviour means writing three things: the clause, the registry row it hangs off, and the DECISIONS
entry wherever an alternative was refused. AMENDING a clause means one more: grep its number across
`docs/` AND this file, and re-read every hit rather than only the `Assumes:` lines. the gate catches
a citation that DANGLES — registry, decisions, brand and these working notes each have a test that
the number still exists — and no test can catch a citation that still RESOLVES while what it meant
moved, which is the whole of an amendment. a decision resting on a premise the amendment removes
goes on reading as valid in both documents, nothing contradicting it and only its REASON having
stopped being true — which is how D3 outlived the monotonicity it was built on for fifty-two
entries. `docs/plans/` holds citations too, and `rulebook.test.ts` now gates the two things a plan
can be mechanically wrong about — a citation resolving to a WITHDRAWN clause, and a proposed
RULEBOOK group that already exists. it does not gate a plan's CLAIMS, so a stale sentence in one
still goes stale in silence. the framework is not written, so a clause is not something to check code against — what it
stops is one rule being decided twice, differently, by two sessions that never met.

each of the four states its own format rules at the top and `packages/dogfood/tests/rulebook.test.ts`
gates them, in both directions: a rule with no name to hang off, and a name with no rule. a rule
that turns out to be checkable belongs in a test rather than in prose — here as much as there.

SOME OF THIS FILE IS GATED TOO, and where it is, the test is the rule and this is the reason:
`packages/abide/tests/conventions.test.ts` holds the self-import ban, the `node:` justification, the
constants leaf and the file-naming rule; `packages/harness/tests/lanes.test.ts` holds the measure
lane's isolation, walked by RESOLUTION rather than by bundling — two earlier spellings each passed
with an abide edge planted one module deep, so the test now carries a second test that the walk
finds abide when abide is there; and
`packages/dogfood/tests/coverage.test.ts` holds the ratio rule — a bench row with no arm beside it
is a figure, not a claim. WHAT IS NOT GATED IS JUDGEMENT, and it is most of the file: whether a name
is descriptive, whether a comment is load-bearing, whether the share was named before the layer was
changed. a check produces CANDIDATES and the rule decides; where no check can produce one, the rule
is all there is.

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface small, based on standards, and ergonomic with no ceremony
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all builds and environments
* isomorphism by default — same callable, same name, same *intent* on both sides
* uses typescript 7 for compiler
* valid typescript or javascript should always compile — in a `.abide`. RULEBOOK 19.13 is the
rule and D22 is why it widens rather than refusing
* a state is read and written BY NAME inside a `.abide` file, and the explicit `x()` / `x.set(v)`
spelling keeps compiling — the sugar is over it, never instead of it. RULEBOOK 31.1, 31.3 and 31.9,
and D28 is why a binding holds rather than reads
* small and low level client bundle built from compiled .abide
* prefer UNIFORMITY over a hard-coded exception, even where the uniform variant is inert. an
option that exists everywhere and does nothing on one producer is one concept; the same option
withheld from that producer is two — the option, and the exception. an inert variant is
understood from the invariant it already carries, where an exception has to be taught, is a
branch in the implementation, and is a case in every debugging session. this is a working bias
here and a decided one there: D96 is the entry, 18.17 the worked case it withdrew
* value performance when all other conditions are met

# seams and imports

* a bun workspace: `packages/abide` is the framework, `packages/harness` is the harness everything is tested and measured with, `packages/dogfood` is the documentation app abide is dogfooded on.
* import across the seams with the `#server` / `#ui` / `#shared`
* the harness's own split is by DEPENDENCY, and that is the whole reason it is a package rather than a folder inside the framework: `harness/measure` has no abide in its graph at all, which is what lets the hand-written arm of a ratio be timed by the same clock and the same batch sizing as the abide arm. FIVE ENTRIES, THREE LANES: `harness/report` depends on nothing and `harness/gate` depends on `bun:test`, so neither is a lane and neither answers a fourth question — RULEBOOK 44.1 and D101.
* an export in the `exports` map is public SURFACE, not dead code — a static tool reporting it unused is reporting that the dogfood app does not exercise it, which is a gap in the dogfood, not machinery to delete
* before adding a helper, grep the sibling seam — the same utility on both sides of `#shared` is the duplication this layout invites. widen the existing one, or lift it to `#shared` when both sides need it; a second implementation is only right when the two seams have genuinely different invariants, and then the comment says which
* an import EDGE is priced by the module it lands on, never by the name it asks for. a module reached from the client entry's STATIC closure keeps every export ANYTHING in the build uses — bun shakes exports fine for a lone entry and stops once the module is in a shared chunk — so one import that reads as free costs that module's whole union on every page.
* a constant crossing a seam lives in a LEAF — its own UPPERCASE file with no imports of its own.
* framework-internal code imports by SEAM, never by this package's own public specifier: `abide` / `abide/runtime` / `abide/server` are what an APP resolves through, and a file inside `packages/abide` reaching for one is asking a curated barrel for a name it could have taken from the module.

# simplification

the standing bias: reduce machinery rather than layer on it. the rules below are how that gets checked — this line is the intent, not a test.

* do not worry about backwards compatibility if there is a better way to do something at any level unless it changes a public api - then discuss
* be aggressive in refactoring when it reduces machinery or increases performance
* when a mechanism is REPLACED, the replaced path leaves in the same change — a shim with no caller, a flag with one live value, an option nothing passes, a branch nothing reaches. machinery that outlived its reason is read on every pass and trusted by the next change, so deleting it later costs more than never landing it. if it must stay, the comment names what still calls it

# writing code

* use bun apis - not node apis unless necessary. a `node:` import in `packages/abide` names the bun api it stands in for, in the comment
* favor imperative/procedural over heavy functional abstractions: prefer `for` / `for of` to an iterator chain in any path walked per row, per frame or per node. three or more chained `.map` / `.filter` / `.reduce` over one collection is a loop written the long way, and each link allocates an intermediate — outside hot paths a short chain is fine when it reads better
* use descriptive variable and function names instead of abbrevations — a name is long enough when a reader who has not opened the callee can say what it returns.
* a named type earns its name with a second reference or an invariant worth stating; a type used at exactly one site belongs inline. narrow or widen an existing type rather than declaring a parallel one-use shape beside it
* write terse comments only when why is unclear. do not write comments where code is self explanatory — and when something was tried and reverted, record the MECHANISM, not just the outcome; an outcome-only note freezes the decision permanently. dont make comments a log of the past
* use tailwindcss classes for styling. a `style=` property is for a value computed at runtime — a measured width, a transform from state — and the comment names the value
* constants should be UPPERCASE_SNAKE_CASE always, including their files
* a file is named after what it EXPORTS when it exports one thing: `SCREAMING_CASE.ts` for a constants leaf, `TitleCase.abide` / `TitleCase.ts` for a component or a class, `camelCase.ts` for a util. a reader who has the import line should not have to open the file to know which of the three it is. the exceptions are the framework's own conventions — `page.abide`, `layout.abide`, `app.ts`, `index.ts` are addresses rather than names.
* comments should guide, but when load bearing for decisions they should be verified by reading code and removed if stale.

# hot paths

a hot path is anything walked per row, per frame, per node or per chunk. the rules below are costs paid per iteration, so they are only rules there — elsewhere they are preferences.

* an object's shape is FIXED at construction: initialize every field the type declares, `undefined` included, rather than adding one on a later path, and keep an array to one element type. a shape that grows a field conditionally is two hidden classes, and every read downstream of it deoptimizes
* prefer a class or a plain record to a closure that captures its enclosing scope — a long-lived object built from a closure keeps that whole scope alive for the object's lifetime, so copy the fields it actually needs. no `delete`, no shape mutation, no dynamic property access in a path walked per row
* never `await` a value that is usually already settled — guard it (`isThenable(v) ? await v : v`); an unconditional await costs a promise wrap and a microtask tick at every call site, and a template slot pays it per row. but a `Reactive` is THENABLE (RULEBOOK 1.5), so wherever one can arrive the guard reads the BRAND first — `isReactive(v)` ahead of `isThenable(v)`, RULEBOOK 1.7 — or the guard written to skip a microtask silently settles a live value to one snapshot instead. the template slot is exactly where both are true at once
* a DOM mutation costs more than the JS that decides it — when a path can compare, key or skip instead of touching a node, that is the cheaper arm even when it adds branches. the claim still needs the ratio: assert NODES MOVED against the vanilla arm, not just ms
* but NODES MOVED IS A COUNT, NOT A COST, and the two part company at exactly one place: a node with no layout box. moving a COMMENT is 0.11 µs and moving an ELEMENT with its subtree is 2.8 µs — 25x — because only the element is in the reflow, and on a 500-row reorder the reflow is 52% of the op and identical however many markers moved with it. so a marker-elision change worth 998 fewer records measured at +0.053 ms on one run and −0.033 on the next — under the noise floor — and was dropped. when a COUNT is what motivates a change, convert it to a cost before writing any of it: time the mutation APART from the forced reflow, say which kind of node the count is counting, and run it twice — one run cannot tell 0.4% from zero, and the arms swapping places between runs is the answer
* a layout read (`offsetWidth`, `getBoundingClientRect`, `scrollTop`) after a write in the same path forces the layout the write invalidated — batch the reads before the writes, or hoist the measurement out of the loop entirely. one such read per row is the whole frame
* detect the common shape and skip the general algorithm — the expensive general path is the fallback, not the default
* a fast path earns its branch with a measured ratio; a branch that exists because ONE caller misbehaved is a patch — fix the caller, or deepen the mechanism until the case falls out of it. three special cases in one mechanism means the mechanism is wrong, not that a fourth is due
* when a shared path gains a DEFAULT with exceptions, enumerate the exceptions from the call sites rather than inferring them — "every caller but one" is one grep away from being checked, and a missed exception fails silently

# reactive invariants

these fail SILENTLY — the output stays right while the work goes wrong, so a correctness test cannot catch any of them. assert the work instead (see "performance and measurement").

* a freshly built wrapper defeats an identity check — when a value is re-wrapped per run (a state envelope, a result record), `oldValue !== value` is always true and every propagation cutoff downstream of it silently stops working
* the inverse costs too: when a value's IDENTITY is what wakes readers, rebuilding it is how the change gets signalled, and an accumulating value then pays a full copy per write — `concat` per chunk is O(n²) over a stream. separate the signal from the payload: push into a buffer, bump a VERSION for readers to subscribe to, and materialise the snapshot on the read that follows. which of the three variants is right is decided by the read/write ratio — version + lazy snapshot when writes dominate, structural compare that KEEPS the old identity when reads dominate, a cursor when the reader consumes in order
* a cap on what is REMEMBERED must not become a cost per write — if raising `tail`, a scrollback or a buffer size makes every write dearer, the retention is being rebuilt rather than appended to. assert it: a ratio between two sizes of the same structure, which is the one timing claim that stays honest across substrates

# performance and measurement

* write a bare bones vanilla js form of an implementation first to justify machinery by perf and LOC and complexity. if it causes tension with existing machinery widen the vanilla rewrite to settle harmony before accepting machinery is justified
* machinery is budgeted in the same shape as perf, against the same vanilla arm: LOC over vanilla, exported names added, branches added to a shared path. an implementation that wins on ms and loses on all three is a trade to state out loud, never a default — and "it's faster" does not settle it, because the vanilla arm is what the ratio is against
* a performance claim is a RATIO against hand-written code in the same substrate — absolute ms from a DOM emulator describe the emulator, not the framework
* NAME THE SHARE BEFORE CHANGING THE LAYER. an optimisation is capped by the fraction of the op it touches, so measure the layer against the WHOLE op somebody waits on and write the fraction down before writing code. two rewrites of the reactive core landed as no-ops because the path they improved is 0.055 of a 1.45 ms op — the ceiling was 4% and both changes were inside the noise. an unmeasured fraction is the measurement to take first, and it is usually an afternoon against a week
* the substrate rule governs PROFILING, not just claims, and the ENGINE is part of the substrate. `bun test` is JSC and a browser arm is V8: the same graph measures 1.67x a hand-written signal in one and 0.21x in the other — inverted, not scaled. a microbenchmark with no DOM in it is not exempt, and neither is a profile that only motivates a change rather than justifying it
* a timing sample must be at least 100x the clock's resolution. browsers coarsen `performance.now()` to 100 µs, so a sub-millisecond op timed once returns the clock rather than the code — every arm reading 0.000 or 0.100 is the tell. batch n operations into one sample and divide
* an EXISTENCE PROOF says whether a number is reachable and localises the search: another implementation doing the same work, on the same input, faster. without one the target may already be the floor. with one, cut the search down by what the two SHARE — but SHARED SOURCE IS NOT SHARED WORK, and reading it that way cost two sessions. two arms ran byte-identical page source and one was 4.5x the other because only one of them shipped a stylesheet: a class no rule mentions is a write with no style recalculation and no paint after it, so the faster arm was not doing the work at all. before believing a proof, make the two arms report the WORK — `RecalcStyleCount` and `LayoutCount` per op, not just ms — and check what the page brings that its source does not name. AN ARM YOU WROTE YOURSELF GETS MORE OF THIS, NOT LESS: it happened again with two comparison arms written that same afternoon, trusted because they were mine — knowing what an arm was meant to do is exactly what stops you checking that it does it. and know what the counters MEAN before running them, because the inference is sharper than the data: identical work counts with a large ms gap is never a difference in the layer being compared, it is a difference in what the two arms were ASKED to do. same DOM records, 6.5x the script, and one page was computing five aggregates the other had never been given
* when an arm is an OUTLIER ON ONE OP and level on the others, suspect the page before the implementation. a cost in a shared layer shows up in every column that walks it; a single column that moves alone is usually something about that one op's input — a class with a rule behind it, a value the others never write
* optimise where the cost crosses PERCEPTION, not where the ratio is largest. a 2x on a 40 µs op is invisible; the case worth designing against is the one crossing a frame (~16 ms) or an interaction budget (~100 ms). state the n at which the op crosses it and measure THERE — and a regression at a small n that stays under the floor is not a cost, which is why "it is slower for ten rows" does not veto a change that is asymptotically better. click -> paint is FRAME QUANTISED, and that makes the wall clock a perception detector rather than a blunt one: every implementation under one frame reads the same ~16.7 ms, so nine ops level at 16.6-17.0 across six frameworks is the ANSWER and not a limitation to resolve with a sharper instrument. reach for cpu only to see which way the headroom runs, and never quote it as latency — 9,102 nodes moved against 954 painted in the same single frame
* correctness tests cannot guard a performance contract: when the contract is "does less work", assert the work (nodes moved, allocations, calls) — the wrong implementation still produces the right output
* THREE LANES ANSWER THREE DIFFERENT QUESTIONS, and reaching for the wrong one is how a claim gets made about the emulator. `harness/measure` counts DOM CALLS from inside the page and is the only lane in both substrates. `harness/engine` is what BLINK did — style, layout, paint, forced layout, and the per-layer durations `shares()` turns into the fraction of the op each layer took — over CDP, so chromium only and driven from the playwright side. `harness/server` is bytes, microtask turns and allocations, on bun. an engine number is not available inside a case body, and that is where the counters live rather than a gap. THE LEAF IS NOT A LANE: `harness/report` holds the `Sample`, the clock, the batcher and `ratio()`, and it is fourth because all three lanes need all four in both substrates — the fifth entry, `harness/gate`, is the bun-side test vocabulary and is not one either
* COUNTS RUN IN `bun test`, ANYTHING WITH A CLOCK RUNS IN `bun run bench`. counts are contention-immune and stay in the parallel gate; `batch()` throws in a parallel worker, throws on a sample under 100x the clock's MEASURED resolution, and throws on a duration whose op touched an emulated DOM — RULEBOOK 44.11, 44.12 and 44.18. `measure()` has no duration field and `time()` throws while the counters are armed, which is the interlock that replaced measuring the counter's own overhead
* A GATE'S REVERT CAN BE RUN. `gate(name, { revert, worth }, body)` from `harness/gate` takes a function installing the broken arm and the number that arm reports, and `bun run test:gates` asserts every one of them FAILS with that number — RULEBOOK 44.9. where the broken arm is structural rather than installable (a module-level guard, a shape fixed at construction) the revert stays a comment naming its number, and this file's own discipline is what carries it
* in a reactive system that means asserting WAKE-UPS, not values: count effect re-runs and body runs, because a reader that woke when nothing it reads changed still reads the right value
* budget emitted code in three numbers: allocations per template node, microtask ticks per row, DOM nodes per list item
* a benchmark case earns its place by DISTINGUISHING implementations, not by being representative — a full reverse cannot tell a minimal keyed reconcile from a rebuild; a two-row swap can. the distinguishing case for COST and for CORRECTNESS are different cases and both are owed: the same two-row swap cannot tell a correct transposition from one that corrupts every other reorder, and the full reverse it is useless for pricing is exactly what catches that
* A GATE IS VERIFIED BY REVERTING THE FIX AND WATCHING IT FAIL. a test written after a change and green on its first run has not been shown to test anything — three written that way passed with the bug still in place. the revert is the check, and the number it reports with the fix out is what the gate is worth (0 -> 597 nodes moved; a reader that woke 4 times instead of 3). this is the whole of the discipline for a "does less work" contract, because nothing about the output moves
* a guard derived from a SUMMARY of the input has to be tested with a case that satisfies the guard and violates what it stands for. `firstChanged`/`lastChanged` BRACKET the changes and say nothing about the middle; read as "the only changes" they let a full reverse through a two-row swap path, right at both ends and wrong between — so compare the WHOLE result, never its edges. and a fuzz that makes ONE change per step cannot reach any of this: the summary and the truth agree by construction, so match the step count to the arity the guard reasons about

# checks

a check produces CANDIDATES, not violations — it names the lines worth reading, and the rule above decides.

* `bun run typecheck && bun run test` — the gate. green before a change and green after; run it from `~/Code` casing or typecheck fails on TS1149 for reasons that have nothing to do with the change, and from the REPO ROOT or `bunfig.toml`'s DOM preload is not found and the harness's own tests measure a different code path while still passing
* the gate is `bun run test` — `bun run build && bun test … --parallel` — and both halves are load-bearing. `--parallel` runs the FILES in worker processes and what that costs is every assumption a file was making about another one having run first: the routing suite drove the address bar through a document some EARLIER file had moved off `about:blank`, and `build.test.ts` and `start.test.ts` shared one `.abide/client` that a build begins by deleting. neither was a parallel bug. both were latent, both had been green for as long as they had existed, and the way to find the next one is `bun test <one-file.test.ts>` — a file that fails ALONE is the honest reading. the build is up front because the two files that SERVE the app now read that artifact rather than each making one; `build.test.ts` builds in a copy of its own, which is why nothing rewrites it under them
* the worker COUNT is not a lever — `--parallel=4` against `--parallel=8` swapped places between runs, which is the answer. what is left is timing: two cases price a ratio and a loaded machine can tie two chunk arrivals that a quiet one separates. so a TIMING failure under `--parallel` is re-run with `bun run test:serial` before it is believed, the same way a contended e2e spec is; anything else red means red
* `bun run test:changed` for the inner loop — only the files git says a change reaches. `bun run e2e:changed` and `bun run e2e:failed` are playwright's end of the same thing, and one spec with its two servers is ~3.5s against the full 40s
* a suite that HANGS reports nothing at all — no failed test, no summary — so when `bun test` stops rather than fails, bisect by file and then by test with `-t`. it has happened twice: a hook with no timeout around a build that grew past 5s
* `bun run e2e` — the browser gate: playwright, two projects over the one app (served, and again under a sub-path),
* a browser assertion is loose by default and that makes a fake gate easy: `hasText` with a string matches case-INSENSITIVELY and as a substring, so `hasText: 'HELLO'` passed against `hello`. break the thing on purpose and watch the test fail — twice now a browser test has been green against a broken page
* `bun run lint` — unused locals, imports and parameters
* `bunx knip --workspace packages/abide` — exports and files nothing resolves through, for "when a mechanism is REPLACED". read it against the public-surface rule in "seams and imports" first, and note it cannot see an import made from a `.abide` file, so every module only a page imports reads as unused
