---
name: conform
description: Drive the abide codebase into the shape CLAUDE.md defines — mechanical checks first, then clustered agent passes per seam, applied aggressively and looped until dry. Use when the user wants to conform, clean up, or sweep the codebase against CLAUDE.md, asks to enforce the project rules across many files, or invokes /conform.
---

# Conform

CLAUDE.md is the specification. This skill closes the gap between it and the code.

Bias to **changing**, not noting. A finding you can fix in the same pass is a fix, not a
report. The two things you never apply unasked: a change to abide's PUBLIC surface, and a
machinery-budget claim you have not measured. Both go to the user.

Every section of CLAUDE.md is owned by a round — the map is at the top of
**[CLUSTERS.md](CLUSTERS.md)**. When CLAUDE.md gains a section and that map does not, the sweep
skips it silently, which is exactly how this skill went stale once already.

## Quick start

```bash
./.claude/skills/conform/scripts/checks.sh --units          # is CLUSTERS.md still describing this tree?
./.claude/skills/conform/scripts/checks.sh --details --e2e  # the full first pass
```

## Phase 0 — Gate

`checks.sh --gate --e2e`. Typecheck clean, `bun test` at 0 fail, and the browser gate green — or
**stop and say so**. Without a green baseline you cannot tell your breakage from what was already
broken. Record the pass counts; they are the numbers every later gate is compared against.

`bun test` and `bun run e2e` run under a watchdog, because CLAUDE.md's hang rule is real: a suite
that hangs reports nothing at all. A `HANG` line means bisect by file, then by test with `-t` — it
does not mean retry.

Also run `checks.sh --units` and compare against CLUSTERS.md's table. A unit that moved, split or
vanished means the round definitions are describing a tree that no longer exists; fix the table
before running any agent against it.

## Phase 1 — Mechanical

`checks.sh --details`. Every hit names the CLAUDE.md section it is judged against. Open that
section, read the rule, then decide — the script finds candidates, the rule finds violations.
Fix in place. Four the script cannot judge for you:

- **knip's unused exports** — dead in `internal/`, public SURFACE in the `exports` map. The
  second kind is a dogfood gap to report, never a deletion. It also cannot see an import made
  from a `.abide` file, so a module only a page imports reads as unused.
- **`await` vs `isThenable` counts** — a ratio, not a list. Read the awaits in per-row paths.
- **alias leaks** — an app reaching `$shared/internal/` is naming something with no public
  spelling. The import is the symptom; the missing entry point is the finding, and it goes to
  the user.
- **harness measure graph** — `harness` MAY import abide. `harness/measure` may not, and that
  check greps only measure.ts's own graph, so any hit at all is a violation.

Gate, then commit. Mechanical fixes land separately from judgment so a bisect can tell them apart.

## Phase 2 — Cluster rounds

Seven clusters over eleven units. Coverage map, unit table, prompt template and output shape:
**[CLUSTERS.md](CLUSTERS.md)**.

Run one cluster per round, in the order CLUSTERS.md lists — reactive invariants first, because
those fail silently and no test in this repo can catch them. Launch that round's agents in a
single message so they run concurrently. Agents are **read-only finders**; they report, you
apply. Parallel editors collide on `$shared`, which every other seam imports.

Read the round's units from `checks.sh --units`, not from memory. `dogfood/demos` is read by
FACE, not whole — CLUSTERS.md says which face each round gets.

## Phase 3 — Apply

Dedup across the round's reports (the cross-seam agent overlaps the per-seam ones). Show the
user the list before touching anything. Then, per seam:

1. apply that seam's findings
2. `checks.sh --gate` — the fast gate, no e2e
3. next seam

Never batch seams between gates. A red gate after one seam is a bisect of one seam.

At the **end of the cluster**, once, run `checks.sh --gate --e2e`. The browser gate is too slow
to run per seam and too load-bearing to skip: it is the only thing that sees an `interact` face,
a rung rendering rather than compiling, and a page with correct markup that throws in the console.

Any fix whose contract is "does less work" lands with a gate, and **a gate is verified by
reverting the fix and watching it fail**. Record the number it reports with the fix out. A gate
green on its first run and never reverted has not been shown to test anything.

## Phase 4 — Loop until dry

Re-run the round. Findings already seen and already rejected do not count as new. **Two
consecutive rounds returning nothing new ends that cluster** — a single quiet round means the
finders got unlucky, not that the seam is clean. Then move to the next cluster.

## Phase 5 — Report

Per cluster: what was fixed, what was skipped and why, what was flagged for the user. State the
gate numbers at the start and the end, e2e included. Name what CLUSTERS.md's "What no round can
check" list left uncovered, so "not checked" never reads as "clean". If a cluster was cut short,
say which and why — a silent stop reads as "clean" when it means "unfinished".

## Escalate, do not apply

- **public api** — CLAUDE.md: "unless it changes a public api - then discuss". That includes
  anything in abide's `exports` map.
- **an unused export in the `exports` map** — a gap in the example, not machinery
- **a machinery budget without a vanilla arm** — "it's faster" does not settle it; if
  `demos/vanilla.ts` has no arm for it, the claim is not yet a claim
- **an optimisation whose SHARE of the op is unmeasured** — the fraction is the measurement to
  take first, and it is usually an afternoon against a week
- **CLAUDE.md's own drift** — a unit that exists and the directory structure does not list, a
  rule that reads two ways on the code in front of you. Report it; do not pick a reading and
  sweep 80 files with it, and do not edit CLAUDE.md as part of a sweep.

## Not this skill's job

Correctness bugs — that is `/code-review`. The one overlap is the reactive-invariants cluster,
whose rules describe real defects; CLAUDE.md names them, so they are in scope here.
