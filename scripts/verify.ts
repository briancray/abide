#!/usr/bin/env bun
// Pre-push gate for `main`. Runs the full quality pipeline, auto-fixing what it can:
//   1. fix       — biome --write (format + safe lint fixes)
//   2. lint      — biome check (fails on anything auto-fix couldn't resolve)
//   3. typecheck — tsc --noEmit across every workspace
//   4. abide     — `abide check` on the docs app: type-checks EVERY .abide sample + the site itself
//   5. test      — abide unit + browser-bundle suite (`bun test`)
//   6. e2e       — docs Playwright suite (serial + 1 retry for stability; browser coverage of samples)
//
// Fails fast on the first hard error and exits non-zero, so it can gate a push (CI job or a git
// pre-push hook: `bun run verify`). Deterministic — no agents, no network beyond the local test
// server. `--fix-only` runs just the auto-fix step.
//
// NOTE: only biome auto-fixes. tsc / abide-check / test / e2e report failures for a human to fix —
// this script surfaces them clearly rather than papering over them.

import { $ } from "bun";

const ROOT = new URL("..", import.meta.url).pathname;
$.cwd(ROOT);

type Step = { name: string; run: () => Promise<unknown>; fixes?: boolean };

const fixOnly = process.argv.includes("--fix-only");

const steps: Step[] = [
  { name: "fix — biome --write", run: () => $`biome check --write`, fixes: true },
  { name: "lint — biome check", run: () => $`biome check` },
  { name: "typecheck — tsc (all workspaces)", run: () => $`bun run --filter '*' typecheck` },
  { name: "abide check — .abide samples + site", run: () => $`bun run --filter docs abide-check` },
  { name: "test — abide bun test", run: () => $`bun run --filter abide test` },
  { name: "e2e — docs Playwright (serial)", run: () => $`bun run --filter docs e2e:ci` },
];

const selected = fixOnly ? steps.filter((s) => s.fixes) : steps;

for (const step of selected) {
  console.log(`\n\x1b[1m▶ ${step.name}\x1b[0m`);
  const result = await step.run().nothrow();
  if (result.exitCode !== 0) {
    console.error(`\n\x1b[31m✗ verify failed at: ${step.name}\x1b[0m`);
    console.error("Fix the reported issues, then re-run `bun run verify`.");
    process.exit(1);
  }
  console.log(`\x1b[32m✓ ${step.name}\x1b[0m`);
}

console.log("\n\x1b[32m✓ verify passed — safe to push.\x1b[0m");
