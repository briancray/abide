# Clusters

A cluster is a set of CLAUDE.md rules that need the same kind of reading. One agent gets one
cluster over one unit — never one agent with twenty checklist items, which goes shallow on all
of them.

## Coverage map

Every section of CLAUDE.md, and what carries it. A section with no owner is a section the sweep
silently skips, which is how this file went stale the first time — when CLAUDE.md gains a
section, it gains a row here in the same change.

| CLAUDE.md section | carried by |
|---|---|
| `# project goals` | **B** (surface, isomorphism, compiler contract) + **E** (bun apis) + **F** (bundle size). Three bullets are unenforceable by any pass — see "What no round can check" |
| `# seams and imports` | **B** (alias ownership, harness dependency split, `exports` map) + **C-reuse** (grep the sibling seam) + mechanical (seam escapes, alias leaks, harness measure graph) |
| `# simplification` | **C**, plus its docs/demos-sync bullet in **G** |
| `# writing code` | **E** |
| `# hot paths` | **D**, except the await and DEFAULT bullets, read in **A** |
| `# reactive invariants` | **A** |
| `# performance and measurement` | **F** |
| `# demos and docs` | **G** |
| `# checks` | the skill's own Phase 0/1/3 gates, plus the misnamed-spec and loose-assertion bullets in **G** |
| `# directory structure` | mechanical — `checks.sh --units`. Drift is reported to the user, never fixed by editing CLAUDE.md |

## Units

Counts are from `checks.sh --units`. **Re-run it before a round** — if a number here is wrong,
this table is stale and so is whatever else it says.

| unit | files | lines |
|---|---|---|
| `packages/abide/compiler` | 19 | 8.2k |
| `packages/abide/cli` | 22 | 4.2k |
| `packages/abide/src/shared` | 34 | 8.8k |
| `packages/abide/src/server` | 21 | 6.7k |
| `packages/abide/src/ui` | 5 | 2.7k |
| `packages/harness` | 18 | 4.0k |
| `packages/dogfood/demos` | 206 | 24.7k |
| `packages/dogfood/test` | 28 | 7.2k |
| `packages/dogfood/pages` | 18 | 0.9k |
| `packages/dogfood/site` | 16 | 1.9k |
| `packages/perf` | 38 | 2.0k |

`demos/fixtures` is no longer its own row — `checks.sh --units` counts it inside
`packages/dogfood/demos`, which is why that number jumped. The 173 fixture files are ~2.5k of
the 24.7k; the 33 suite files at the top level are the other 22.2k.

Every unit here fits in one agent's context whole, with one exception. Read it entirely; do not
sample.

**`dogfood/demos` is the one exception and it must be stated, not fudged.** 22.2k lines over 33
suite files does not fit the way the others do, so it is read BY FACE: round F reads the `bench`
faces and `vanilla.ts`, round G reads `run` / `interact` / `examples`. An agent told to read it
"whole" will sample and not say so. Round D reads the `bench` faces too — 18 of the 33 suites
have one.

`packages/abide/cli` is a unit `abide/cli` is a public specifier for, and CLAUDE.md's directory
structure does not list it. That is a CLAUDE.md gap to report, not to paper over.

## Rounds

Run in this order. Clusters do not multiply across units — each names the units it applies to.

| # | cluster | CLAUDE.md sections | units | agents |
|---|---|---|---|---|
| A | reactive invariants | `# reactive invariants`, plus the await and DEFAULT bullets in `# hot paths` | shared, ui, server | 3 |
| B | seams & public surface | `# seams and imports` (alias ownership, harness split, `exports` map), the surface/isomorphism/compiler bullets of `# project goals` | see below | 3 |
| C | simplification | `# simplification` | compiler, cli, shared, server, ui, bench | 6 |
| C | cross-seam reuse | the reuse bullet in `# seams and imports` | `$shared` read against server/ui/compiler | 1 |
| D | hot paths | `# hot paths` | shared, ui, compiler, bench | 4 |
| E | writing code | `# writing code`, plus the bun-apis bullet of `# project goals` | compiler, cli, shared, server, ui, bench | 6 |
| F | measurement | `# performance and measurement` | demos `bench` faces + `vanilla.ts`, `packages/perf`, `harness/measure` | 3 |
| G | demos & docs | `# demos and docs`, the spec-and-demos bullet of `# simplification`, the browser-gate bullets of `# checks` | demos `run`/`interact`/`examples` + fixtures, pages+site, `docs/spec.md` + e2e | 3 |

**Round A first.** Those rules describe silent failures — right output, wrong work — and
CLAUDE.md says outright that a correctness test cannot guard them. Everything else in the file
describes code that is merely heavier than it needs to be.

**Round B's three agents are not three units.** They are three readings that each cross the
package boundary: (1) abide's `exports` map and entry points against every consumer, (2)
`harness`'s dependency split — `harness/measure` with no abide in its graph, `harness/spawn`
reaching neither app, (3) the compiler contract from `# project goals` — valid TS/JS always
compiles in a `.abide`, the explicit `x()` / `x.set(v)` spelling still compiles, and what counts
as a cell is decided SYNTACTICALLY so nothing in the emit path needs a type-checker.

**Cross-seam reuse cannot be split per unit.** An agent reading `$shared` alone cannot see the
duplicate sitting in `$server`. It gets its own agent and reads the seams together.

## Prompt template

> You are checking `<unit>` in the abide repo against a specific set of rules from its CLAUDE.md.
> Read every file in the unit. Do not sample. <or, for dogfood/demos: Read the `<face>` face of
> every suite; you are not being asked for the other faces.>
>
> The rules, verbatim:
> <paste the cluster's CLAUDE.md bullets — the literal text, not a summary>
>
> For each finding return: `file:line`, the rule it breaks (quoted), the concrete cost (what is
> duplicated, wasted, rebuilt per write, or harder to maintain), and the change you would make.
>
> Only report what you can pin to a line and a quoted rule. No style preferences, no "spirit of
> the doc". If a rule reads two ways against the code in front of you, say so instead of picking
> one — the ambiguity is a bug in CLAUDE.md and the user decides it.
>
> A hot-path rule only binds in a path walked per row, per frame, per node or per chunk. Say
> which one, or it is not a finding.
>
> A measurement rule binds on a claim, not on code: name the claim, where it is asserted, and
> which arm it is a ratio against.
>
> Do not report correctness bugs; a separate review covers those. Do not edit any file.
> Return nothing rather than padding — an empty result is a real answer.

Paste the rules **verbatim**. Summarizing them is how "quote the exact rule" stops being
possible, and an unquotable rule cannot be enforced by anyone downstream.

## Per-cluster notes

**A — reactive invariants.** Trace data flow, not syntax. The tells: a value re-wrapped per run
upstream of an `oldValue !== value` check; an accumulator rebuilt rather than appended to; a
retention cap whose size changes the per-write cost. `router.ts`'s params and `wire.ts`'s line
reader are the two the file names as done right — use them as the reference shape. The third
variant, version + lazy snapshot, is the one to reach for when writes dominate; a finding that
proposes one of the three owes the read/write ratio that picks it.

**B — seams & public surface.** The alias rule is new and it is directional: `packages/abide` uses
`$shared` and friends, everyone else uses the public specifiers `abide` / `abide/ui` /
`abide/server` / `abide/runtime` / `abide/compiler` / `abide/cli`. `checks.sh` finds the leaks;
this round decides whether the leak wants a widened public entry point or a moved helper — an
alias reaching `$shared/internal/` from an app is naming something that has no public spelling,
and that is the finding, not the import. A change to the `exports` map goes to the user.

**C — simplification.** The high-yield question is "what did this replace, and is the replaced
thing still here?" Cross-check against knip from Phase 1 before spending judgment on what a
static tool already proved dead. A shim with no caller, a flag with one live value, an option
nothing passes, a branch nothing reaches — and a comment that names what still calls it is the
only thing that keeps one.

**D — hot paths.** Every finding must name the iteration it costs per. A shape-stability or
closure finding in a path that runs once at startup is not a finding. **NODES MOVED IS A COUNT,
NOT A COST** now qualifies the nodes-moved rule this cluster is built on: a marker-elision
finding motivated by a record count is not a finding until the count is converted to a cost —
which kind of node, timed apart from the forced reflow, run twice. A count-only finding is
reported as "needs a cost" and applied by nobody.

**E — writing code.** The cheapest cluster and the one most likely to produce noise. Hold the
line on the stated exceptions: `i`/`j`, the project's own terms (cell, seam, arm, face), a
`style=` whose value is computed at runtime and whose comment names the value, and a short
iterator chain outside a hot path where it reads better. A `node:` import is a finding only if
its comment does not name the bun api it stands in for. A named type used at exactly one site
belongs inline; a type with a second reference or an invariant worth stating keeps its name.

**F — measurement.** This round reads CLAIMS, not code, and every rule in the section is a way a
claim can be false while the number is real:

- **name the share first** — an optimisation is capped by the fraction of the op it touches. A
  bench arm with no fraction written down is the finding.
- **the substrate includes the ENGINE** — a `bun test` bench is JSC and an e2e bench is V8, and
  the same graph inverted between them. A ratio quoted without its engine is not a ratio.
- **100x the clock** — an arm reading 0.000 or 0.100 is reporting the clock. Check the batch size.
- **existence proof needs work counters** — `RecalcStyleCount` / `LayoutCount` per op, not ms.
  Shared source is not shared work; an arm written in this repo gets more of this check, not less.
- **outlier on one op** — suspect the page's input before the layer.
- **perception, not ratio** — state the n at which the op crosses a frame or 100 ms, and measure
  there. Nine arms level at 16.6–17.0 ms is the answer, not an instrument problem.
- **a gate is verified by reverting the fix** — this is the highest-yield question in the round,
  and it applies to every gate the earlier rounds' fixes landed with. A "does less work" test
  green on its first run and never reverted has not been shown to test anything. Ask, per gate:
  what number does it report with the fix out?
- **distinguishing cases come in pairs** — a two-row swap prices a reconcile, a full reverse
  catches the transposition it corrupts. A suite with only one of the two is a gap.
- **a summary-derived guard** needs a case that satisfies the guard and violates what it stands
  for, and a fuzz whose step count matches the guard's arity — one change per step cannot reach it.

**G — demos & docs.** The four faces, and the one place where "the test is wrong" is the finding.

- `run` is headless: a claim needing a click belongs in `interact` and is asserted by `bun run e2e`.
  A `run` face that would need a browser is the finding; so is an `interact` face with no e2e spec.
- `examples` is the LADDER: every rung is the one before it plus **exactly one** new thing, named
  in `adds`. A rung showing two things, or a rung whose explanation lives in a comment header
  rather than on the page, is the finding.
- A rung is a real file this app compiles, shown through `?source` — `Function.prototype.toString`
  reports the BUNDLER's text once built.
- `docs/spec.md` and the demos are the two places behavior is written down. A behavior changed in
  one and not the other is this round's finding, and it is the `# simplification` bullet's whole point.
- A browser assertion is loose: `hasText` is case-insensitive and substring. An e2e assertion that
  would pass against a broken page is a fake gate — say which string, and what it would also match.

## What no round can check

Stated so the report can say "not covered" instead of implying "clean":

- "maintain high visibility into the stack for debugging" — a property of the whole, not a line.
- "uses typescript 7 for compiler" — a fact, not a rule.
- "value performance when all other conditions are met" — the tiebreak, and the standing bias in
  `# simplification`, are how findings are RANKED. They do not generate any.
