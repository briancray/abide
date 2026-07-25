// BENCH DELTA — A/B the working tree against a base git ref.
//
// Runs BOTH corpora against the WORKING TREE and against a base git ref (default HEAD), then reports the
// per-metric change. The point is to answer "did my uncommitted abide changes speed up or slow down…":
//   • the UI triad — render / mount / update (`run.ts`)
//   • the server + reactive/stream/channel primitives (`server.ts`) — route, cache-key, memo, state,
//     probe, stream, watch, fanout, codec. Loopback `dispatch/*` rows are included but are the noisiest
//     (they carry a TCP floor); read those relative to `dispatch/health`.
//
//   bun run bench:delta            # working tree vs HEAD
//   bun run bench:delta -- <ref>   # working tree vs <ref> (branch, tag, or SHA)
//   bun run bench:delta -- --no-fail   # report only; do not exit non-zero on a regression
//
// Both corpora also carry their vanilla baselines. Those rows run the SAME hand-written code on both
// sides, so they are printed as a NOISE CONTROL — their worst swing is this run's noise floor, and a
// "regression" smaller than it means nothing. They are excluded from the verdict.
//
// Exits NON-ZERO when any metric regresses past the threshold, so it can gate a change deliberately.
// (`bun run verify` uses the cheaper hardware-neutral `bench:gate` instead — this one needs a worktree
// and runs every bench twice.)
//
// Run at the DEFAULT budget for a trustworthy verdict: a short ABIDE_BENCH_TIME makes ±5–10% swings
// routine and will flag phantom regressions on identical source.
//
// The base ref is checked out into a throwaway git worktree. Bench now imports `abide` by package name
// (not relative `../src`), so to bench the BASE library we run the CURRENT harness with its `abide`
// resolution repointed at the worktree's base source via a local `node_modules/abide` symlink; every
// other dependency resolves up to this checkout's `node_modules` (symlinked in). Both sides therefore
// execute identical measurement code against different abide source. A metric is flagged when it moves
// more than ABIDE_BENCH_THRESHOLD percent (default 5).

import { cp, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BenchReport, ScenarioResult } from './run.ts'
import type { ServerBenchReport } from './server.ts'
import type { MetricResult } from './src/measure.ts'

const BENCH_PKG_DIR = import.meta.dir
const REPO_ROOT = join(BENCH_PKG_DIR, '..', '..')
const THRESHOLD = Number(process.env.ABIDE_BENCH_THRESHOLD ?? 5)

const baseRef = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'HEAD'
const noFail = process.argv.includes('--no-fail')

async function git(args: string[], cwd: string): Promise<string> {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    if (code !== 0) throw new Error(`git ${args.join(' ')} failed: ${err.trim()}`)
    return out.trim()
}

// Run one bench harness at `cwd` and parse its JSON report (last JSON line of stdout).
async function runScriptAt<T>(cwd: string, script: string): Promise<T> {
    const proc = Bun.spawn(['bun', 'run', script, '--json'], {
        cwd,
        stdout: 'pipe',
        stderr: 'inherit',
        env: process.env,
    })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (code !== 0) throw new Error(`${script} at ${cwd} exited ${code}`)
    const line = out
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .at(-1)
    if (!line) throw new Error(`${script} at ${cwd} produced no JSON:\n${out}`)
    return JSON.parse(line) as T
}

interface Corpora {
    frontend: BenchReport
    server: ServerBenchReport
}

async function runBenchAt(cwd: string): Promise<Corpora> {
    // Sequential, not parallel: the server corpus binds loopback sockets and both sides must not
    // contend for CPU, or the numbers stop being comparable.
    const frontend = await runScriptAt<BenchReport>(cwd, 'run.ts')
    const server = await runScriptAt<ServerBenchReport>(cwd, 'server.ts')
    return { frontend, server }
}

async function benchBaseRef(): Promise<Corpora> {
    const worktree = await mkdtemp(join(tmpdir(), 'abide-bench-'))
    const worktreeBench = join(worktree, 'packages', 'bench')
    try {
        await git(['worktree', 'add', '--detach', worktree, baseRef], REPO_ROOT)
        // node_modules is gitignored (absent in the fresh worktree); reuse this checkout's install for
        // every dependency EXCEPT abide, which the local symlink below pins to the worktree's base source.
        await symlink(join(REPO_ROOT, 'node_modules'), join(worktree, 'node_modules'), 'dir')
        // Workspace-local installs are NOT hoisted to the root node_modules — `@happy-dom/global-registrator`
        // lives in packages/{abide,bench}/node_modules — and a fresh worktree has none. Link the base abide
        // package's install so its own modules (notably `src/test/happydom.ts`) resolve.
        await symlink(
            join(REPO_ROOT, 'packages', 'abide', 'node_modules'),
            join(worktree, 'packages', 'abide', 'node_modules'),
            'dir',
        )
        // Run the CURRENT harness (overlay it over the base bench package) so measurement code is fixed.
        await rm(worktreeBench, { recursive: true, force: true })
        await cp(BENCH_PKG_DIR, worktreeBench, {
            recursive: true,
            filter: (src) => !src.includes('node_modules'),
        })
        // Give the overlaid harness this checkout's bench deps, entry by entry, so `abide` can be pinned to
        // the BASE source below rather than inheriting the workspace link.
        await mkdir(join(worktreeBench, 'node_modules'), { recursive: true })
        const benchModules = join(REPO_ROOT, 'packages', 'bench', 'node_modules')
        for (const entry of await readdir(benchModules)) {
            if (entry === 'abide') continue
            await symlink(
                join(benchModules, entry),
                join(worktreeBench, 'node_modules', entry),
                'dir',
            )
        }
        // Repoint `abide` to the worktree's BASE source: bench resolves it from its own node_modules first.
        await symlink(
            join(worktree, 'packages', 'abide'),
            join(worktreeBench, 'node_modules', 'abide'),
            'dir',
        )
        return await runBenchAt(worktreeBench)
    } finally {
        await git(['worktree', 'remove', '--force', worktree], REPO_ROOT).catch(() => {})
        await rm(worktree, { recursive: true, force: true }).catch(() => {})
        await git(['worktree', 'prune'], REPO_ROOT).catch(() => {})
    }
}

interface Row {
    label: string
    base: number
    current: number
    deltaPct: number
    // A vanilla-baseline row: the SAME hand-written code ran on both sides, so any delta here is pure
    // machine noise, not a change you made. Printed as a control (how much drift this run is worth
    // ignoring) and excluded from the regression verdict.
    control: boolean
}

function row(label: string, base: number, current: number, control: boolean): Row {
    return { label, base, current, deltaPct: ((current - base) / base) * 100, control }
}

function collect(base: Corpora, current: Corpora): Row[] {
    const rows: Row[] = []

    // UI triad
    const baseByName = new Map(base.frontend.scenarios.map((s) => [s.name, s]))
    const metrics: (keyof Omit<ScenarioResult, 'name'>)[] = ['render', 'mount', 'update']
    const vanillaMetrics: (keyof Omit<ScenarioResult, 'name'>)[] = [
        'vanillaRender',
        'vanillaMount',
        'vanillaUpdate',
    ]
    for (const cur of current.frontend.scenarios) {
        const b = baseByName.get(cur.name)
        if (!b) continue
        for (const metric of metrics) {
            const cm = cur[metric] as MetricResult | null
            const bm = b[metric] as MetricResult | null
            if (!cm || !bm) continue
            rows.push(row(`${cur.name} · ${metric}`, bm.nsPerOp, cm.nsPerOp, false))
        }
        for (const metric of vanillaMetrics) {
            const cm = cur[metric] as MetricResult | null
            const bm = b[metric] as MetricResult | null
            if (!cm || !bm) continue
            rows.push(row(`${cur.name} · ${metric}`, bm.nsPerOp, cm.nsPerOp, true))
        }
    }

    // Server + reactive/stream/channel primitives
    const baseByLabel = new Map(base.server.results.map((r) => [`${r.group}/${r.name}`, r]))
    for (const cur of current.server.results) {
        const label = `${cur.group}/${cur.name}`
        const b = baseByLabel.get(label)
        if (!b) continue
        rows.push(row(label, b.metric.nsPerOp, cur.metric.nsPerOp, false))
        if (cur.vanilla && b.vanilla)
            rows.push(row(`${label} · vanilla`, b.vanilla.nsPerOp, cur.vanilla.nsPerOp, true))
    }

    return rows
}

function fmtNs(ns: number): string {
    if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`
    if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`
    return `${ns.toFixed(0)} ns`
}

function flag(row: Row): string {
    if (row.control) return '· noise control (same code both sides)'
    if (row.deltaPct > THRESHOLD) return '⚠ slower'
    if (row.deltaPct < -THRESHOLD) return '✓ faster'
    return ''
}

function printDelta(rows: Row[]): void {
    const labelWidth = Math.max(8, ...rows.map((r) => r.label.length))
    const head = `${'metric'.padEnd(labelWidth)}  ${'base'.padStart(10)}  ${'current'.padStart(10)}  ${'delta'.padStart(9)}  flag`
    console.log(`\nworking tree vs ${baseRef} (threshold ±${THRESHOLD}%, negative = faster)\n`)
    console.log(head)
    console.log('-'.repeat(head.length))
    for (const r of rows) {
        const sign = r.deltaPct >= 0 ? '+' : ''
        console.log(
            `${r.label.padEnd(labelWidth)}  ${fmtNs(r.base).padStart(10)}  ${fmtNs(r.current).padStart(10)}  ${`${sign}${r.deltaPct.toFixed(1)}%`.padStart(9)}  ${flag(r)}`,
        )
    }
    const judged = rows.filter((r) => !r.control)
    const regressions = judged.filter((r) => r.deltaPct > THRESHOLD).length
    const wins = judged.filter((r) => r.deltaPct < -THRESHOLD).length
    console.log(
        `\n${wins} faster · ${regressions} slower · ${judged.length - wins - regressions} within ±${THRESHOLD}%`,
    )
    // The controls ran identical code on both sides: their worst swing is this run's noise floor. A
    // regression smaller than it is not a signal.
    const controls = rows.filter((r) => r.control)
    if (controls.length > 0) {
        const worst = Math.max(...controls.map((r) => Math.abs(r.deltaPct)))
        console.log(
            `${controls.length} vanilla control(s) excluded from the verdict — worst swing ±${worst.toFixed(1)}%, this run's noise floor`,
        )
    }
}

console.log(`benchmarking base ref: ${baseRef} …`)
const base = await benchBaseRef()
console.log('benchmarking working tree …')
const current = await runBenchAt(BENCH_PKG_DIR)
const rows = collect(base, current)
printDelta(rows)

const regressed = rows.filter((r) => !r.control && r.deltaPct > THRESHOLD)
if (regressed.length > 0 && !noFail) {
    console.error(
        `\n\x1b[31m✗ ${regressed.length} metric(s) regressed past ${THRESHOLD}% vs ${baseRef}\x1b[0m`,
    )
    console.error('Re-run with --no-fail to report without failing.')
    process.exit(1)
}
