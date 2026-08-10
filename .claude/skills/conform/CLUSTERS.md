# Clusters

A cluster is a set of CLAUDE.md rules that need the same kind of reading. One agent gets one
cluster over one unit — never one agent with twenty checklist items, which goes shallow on all
of them.

## Units

| unit | files | lines |
|---|---|---|
| `packages/abide/compiler` | 18 | 6.0k |
| `packages/abide/src/shared` | 30 | 6.2k |
| `packages/abide/src/server` | 17 | 5.3k |
| `packages/abide/src/ui` | 5 | 1.6k |
| `packages/abide/tests` | 6 | 1.4k |
| `packages/example/demos` | — | 20.9k pkg |

Each framework unit fits in one agent's context whole. Read the unit entirely; do not sample.

## Rounds

Run in this order. Clusters do not multiply across units — each names the units it applies to.

| # | cluster | CLAUDE.md sections | units | agents |
|---|---|---|---|---|
| A | reactive invariants | `# reactive invariants`, plus the await and DEFAULT rules in `# hot paths` | shared, ui, server | 3 |
| B | simplification | `# simplification` | all five framework units | 5 |
| B | cross-seam reuse | the reuse rule in `# seams and imports` | `$shared` read against server/ui/compiler | 1 |
| C | hot paths | `# hot paths` | shared, ui, compiler | 3 |
| D | writing code | `# writing code` | all five framework units | 5 |
| E | measurement & demos | `# performance and measurement`, `# demos and docs` | `example/demos`, `example/test` | 2 |

**Round A first.** Those rules describe silent failures — right output, wrong work — and
CLAUDE.md says outright that a correctness test cannot guard them. Everything else in the file
describes code that is merely heavier than it needs to be.

**Cross-seam reuse cannot be split per unit.** An agent reading `$shared` alone cannot see the
duplicate sitting in `$server`. It gets its own agent and reads the seams together.

## Prompt template

> You are checking `<unit>` in the abide repo against a specific set of rules from its CLAUDE.md.
> Read every file in the unit. Do not sample.
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
> Do not report correctness bugs; a separate review covers those. Do not edit any file.
> Return nothing rather than padding — an empty result is a real answer.

Paste the rules **verbatim**. Summarizing them is how "quote the exact rule" stops being
possible, and an unquotable rule cannot be enforced by anyone downstream.

## Per-cluster notes

**A — reactive invariants.** Trace data flow, not syntax. The tells: a value re-wrapped per run
upstream of an `oldValue !== value` check; an accumulator rebuilt rather than appended to; a
retention cap whose size changes the per-write cost. `router.ts`'s params and `wire.ts`'s line
reader are the two the file names as done right — use them as the reference shape.

**B — simplification.** The high-yield question is "what did this replace, and is the replaced
thing still here?" Cross-check against knip from Phase 1 before spending judgment on what a
static tool already proved dead.

**C — hot paths.** Every finding must name the iteration it costs per. A shape-stability or
closure finding in a path that runs once at startup is not a finding.

**D — writing code.** The cheapest cluster and the one most likely to produce noise. Hold the
line on the stated exceptions: `i`/`j`, the project's own terms, and a `style=` whose value is
computed at runtime.

**E — measurement & demos.** Check that bench arms measure a RATIO against `demos/vanilla.ts`,
that a case distinguishes implementations rather than being representative, and that a claim
needing a click stays out of `run`. This cluster reads tests and benches — it is the one place
where "the test is wrong" is the finding.
