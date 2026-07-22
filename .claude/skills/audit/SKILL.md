---
name: audit
description: End-of-session consistency audit — checks that the four abide truth surfaces (docs/spec/*.md, root CLAUDE.md, the packages/docs docs app, the packages/starter starter app) still reflect what this session actually changed. Use at the end of a session, before committing/PR, or when the user asks to "audit", "check the docs/specs are true", "audit consistency", or "make sure everything's in sync".
---

# audit

Verify that the session's real changes are reflected across abide's four **truth surfaces**. The goal
is to catch drift — behavior that changed in code but not in the docs that describe it, or example
apps that would now behave differently — *not* to rubber-stamp. Steer each auditor at the surface's
**purpose**; let it decide what to read. Do not hand it a checklist.

## Step 1 — Establish what the session changed

Build the ground truth before auditing anything. From the conversation and the diff:

- `git diff main...HEAD --stat` and `git diff` for the working tree — what code/behavior moved.
- Note which changes are **observable** (public API, template grammar, CLI flags, env vars, wire
  behavior, defaults) vs. purely internal. Only observable changes can create surface drift.

Write a short "change ledger" (bullet list of behavior deltas). This is the input every auditor gets.

## Step 2 — Fan out one auditor per surface (parallel)

Launch these as concurrent `Explore`/`general-purpose` agents. Give each the change ledger and the
**purpose framing** below — then let the agent find the relevant files itself.

- **Specs** (`docs/spec/*.md`) — the *authoritative design*. For each ledgered change, does the
  governing spec still describe how the code now behaves? Flag specs that describe the old design, and
  design decisions made this session that never landed in any spec. Specs lead code, so a mismatch may
  mean the code drifted from intent — surface it either way.
- **Public API ref** (`/CLAUDE.md`) — the *generated public surface*. Every new/changed/removed public
  export, signature, opt, template form, CLI command, or env var must match. This is what users read;
  precision matters. Also verify the coding-guidelines/goals framing didn't get contradicted.
- **Docs app** (`packages/docs`) — the *dogfooding proof*. Live demos are
  `src/ui/demos/<section>/<Name>.abide`; coverage is tracked in `CAPABILITIES.md`; behavior is asserted
  by `e2e/*.spec.ts` (Playwright). Does a changed capability still have a demo that exercises the *new*
  behavior, a `CAPABILITIES.md` entry, and a passing e2e? New public capability with no demo/entry = gap.
- **Starter app** (`packages/starter`) — the *scaffold users start from*. It must still build, serve,
  and pass `e2e/smoke.spec.ts` under the changed framework. Flag anything the scaffold does that the
  session made wrong, deprecated, or non-idiomatic.

Each auditor returns: concrete `file:line` drift items, each tagged **must-fix** (users would be
misled / it's broken) or **nice-to-have** (stale-ish, low harm), plus anything it was unsure about.

## Step 3 — Consolidate and (optionally) verify

- Merge findings, drop duplicates, rank must-fix first.
- If a finding claims code behaves a certain way, spot-check the actual source before trusting it —
  auditors read excerpts and can be wrong. See [[verify-against-docs-app]] and the memory notes on
  browser-only surfaces before asserting hydration/soft-nav behavior.
- Present the ledger + ranked findings. **Do not edit** unless the user asks — then fix must-fix items
  first and re-run the relevant e2e (`cd packages/docs && bunx playwright test`,
  `cd packages/abide && bun test`, per the run-from-cwd memory).

## Notes

- Scope to what *this session* touched. A pre-existing doc gap unrelated to the session's changes is
  out of scope unless the session was supposed to close it.
- No session changes touch an observable surface? Say so and stop — an empty audit is a valid result.
