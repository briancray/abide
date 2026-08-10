---
name: conform
description: Drive the abide codebase into the shape CLAUDE.md defines — mechanical checks first, then clustered agent passes per seam, applied aggressively and looped until dry. Use when the user wants to conform, clean up, or sweep the codebase against CLAUDE.md, asks to enforce the project rules across many files, or invokes /conform.
---

# Conform

CLAUDE.md is the specification. This skill closes the gap between it and the code.

Bias to **changing**, not noting. A finding you can fix in the same pass is a fix, not a
report. The two things you never apply unasked: a change to abide's PUBLIC surface, and a
machinery-budget claim you have not measured. Both go to the user.

## Quick start

```bash
./.claude/skills/conform/scripts/checks.sh --details
```

## Phase 0 — Gate

`checks.sh --gate`. Typecheck clean and `bun test` at 0 fail, or **stop and say so** — without
a green baseline you cannot tell your breakage from what was already broken. Record the pass
count; it is the number every later gate is compared against.

## Phase 1 — Mechanical

`checks.sh --details`. Every hit names the CLAUDE.md section it is judged against. Open that
section, read the rule, then decide — the script finds candidates, the rule finds violations.
Fix in place. Two the script cannot judge for you:

- **knip's unused exports** — dead in `internal/`, public SURFACE in the `exports` map. The
  second kind is a dogfood gap to report, never a deletion.
- **`await` vs `isThenable` counts** — a ratio, not a list. Read the awaits in per-row paths.

Gate, then commit. Mechanical fixes land separately from judgment so a bisect can tell them apart.

## Phase 2 — Cluster rounds

Five rule clusters over six units. Full matrix, prompt template and output shape:
**[CLUSTERS.md](CLUSTERS.md)**.

Run one cluster per round, in the order CLUSTERS.md lists — reactive invariants first, because
those fail silently and no test in this repo can catch them. Launch that round's agents in a
single message so they run concurrently. Agents are **read-only finders**; they report, you
apply. Parallel editors collide on `$shared`, which every other seam imports.

## Phase 3 — Apply

Dedup across the round's reports (the cross-seam agent overlaps the per-seam ones). Show the
user the list before touching anything. Then, per seam:

1. apply that seam's findings
2. `checks.sh --gate`
3. next seam

Never batch seams between gates. A red gate after one seam is a bisect of one seam.

## Phase 4 — Loop until dry

Re-run the round. Findings already seen and already rejected do not count as new. **Two
consecutive rounds returning nothing new ends that cluster** — a single quiet round means the
finders got unlucky, not that the seam is clean. Then move to the next cluster.

## Phase 5 — Report

Per cluster: what was fixed, what was skipped and why, what was flagged for the user. State the
gate numbers at the start and the end. If a cluster was cut short, say which and why — a
silent stop reads as "clean" when it means "unfinished".

## Escalate, do not apply

- **public api** — CLAUDE.md: "unless it changes a public api - then discuss"
- **an unused export in the `exports` map** — a gap in the example, not machinery
- **a machinery budget without a vanilla arm** — "it's faster" does not settle it; if
  `demos/vanilla.ts` has no arm for it, the claim is not yet a claim
- **a rule that reads two ways on the code in front of you** — the ambiguity is a CLAUDE.md
  bug. Report it; do not pick a reading and sweep 80 files with it.

## Not this skill's job

Correctness bugs — that is `/code-review`. The one overlap is the reactive-invariants cluster,
whose rules describe real defects; CLAUDE.md names them, so they are in scope here.
