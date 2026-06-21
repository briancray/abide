import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
Ship-time perf delta. Benchmarks are machine-relative, so a committed baseline only
means something on the machine that wrote it — the only honest comparison is base vs
head on the SAME machine, back to back. This checks out the base ref into a throwaway
git worktree, runs its gate to record a base baseline (in a temp file, via
BENCH_BASELINE), then runs the head gate against that baseline — reusing gate.ts's
ratio table and its 1.4× regression check. Run:

  bun packages/abide/bench/delta.ts            # head vs origin/main
  bun packages/abide/bench/delta.ts <ref>      # head vs <ref> (tag, sha, branch)

Exit code mirrors the head gate: non-zero iff a metric regressed past tolerance, so
ship can gate on it. If the base ref can't bench (e.g. its benches predate this
tooling), the delta is skipped with a warning and exit 0 — a missing base must not
block a release.
*/

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const baseRef = process.argv[2] ?? 'origin/main'
/* Throwaway paths in the OS temp dir (not the repo), keyed by pid so concurrent runs
   don't collide. The base run writes its baseline here for the head run to read. */
const worktreeDir = join(tmpdir(), `abide-bench-base-${process.pid}`)
const baseBaseline = join(tmpdir(), `abide-bench-base-${process.pid}.json`)
const gate = join(here, 'gate.ts')

/* Run a command; inherit stdio (unless quiet) so the gate's table streams through. */
async function run(
    cmd: string[],
    options: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {},
): Promise<number> {
    const child = Bun.spawn(cmd, {
        cwd: options.cwd ?? repoRoot,
        env: { ...process.env, ...options.env },
        stdout: options.quiet ? 'pipe' : 'inherit',
        stderr: options.quiet ? 'pipe' : 'inherit',
    })
    return await child.exited
}

async function cleanup(): Promise<void> {
    await run(['git', 'worktree', 'remove', '--force', worktreeDir], { quiet: true })
    await Bun.file(baseBaseline)
        .unlink()
        .catch(() => undefined)
}

/* Returns the head gate's exit code (0 = within tolerance), or 0 when the delta is
   skipped — a base that can't bench must not block a release. cleanup runs in finally,
   so no early process.exit (which would bypass it). */
async function delta(): Promise<number> {
    if (
        (await run(['git', 'worktree', 'add', '--detach', worktreeDir, baseRef], {
            quiet: true,
        })) !== 0
    ) {
        console.warn(`⚠ could not check out ${baseRef} into a worktree — skipping perf delta.`)
        return 0
    }
    try {
        /* Record the base baseline from the base ref's OWN gate (its benches, its metric
           names), into the shared temp file. If the base can't bench — its benches predate
           this tooling, or a metric was renamed — skip without failing the ship. */
        console.log(`recording base (${baseRef})…\n`)
        const baseGate = join(worktreeDir, 'packages/abide/bench/gate.ts')
        const recorded = await run(['bun', baseGate, '--update'], {
            cwd: worktreeDir,
            env: { BENCH_BASELINE: baseBaseline },
            quiet: true,
        })
        if (recorded !== 0 || !(await Bun.file(baseBaseline).exists())) {
            console.warn(`⚠ ${baseRef} could not produce a baseline — skipping perf delta.`)
            return 0
        }
        /* Compare head against the base baseline on this machine. gate.ts prints the
           baseline/current/ratio table and exits non-zero on a >tolerance regression. */
        console.log('comparing head…\n')
        return await run(['bun', gate], { env: { BENCH_BASELINE: baseBaseline } })
    } finally {
        await cleanup()
    }
}

console.log(`\nperf delta — head vs ${baseRef}\n`)
process.exitCode = await delta()
