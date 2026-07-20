// FRONTEND BENCH DELTA.
//
// Runs the standard bench corpus against the WORKING TREE and against a base git ref (default HEAD),
// then reports the per-metric change. The point is to answer "did my uncommitted frontend changes
// speed up or slow down render/mount/update vs what's committed?".
//
//   bun run bench:delta            # working tree vs HEAD
//   bun run bench:delta -- <ref>   # working tree vs <ref> (branch, tag, or SHA)
//
// The base is checked out into a throwaway git worktree; the CURRENT bench harness (bench/) is copied
// in and run there, so both sides execute identical measurement code against different library source.
// node_modules is symlinked from this checkout (deps are assumed unchanged across the compared refs).
// A metric is flagged when it moves more than ABIDE_BENCH_THRESHOLD percent (default 5).

import { cp, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BenchReport, MetricResult, ScenarioResult } from './run.ts'

const BENCH_DIR = import.meta.dir
const PACKAGE_DIR = join(BENCH_DIR, '..')
const REPO_ROOT = join(PACKAGE_DIR, '..', '..')
const THRESHOLD = Number(process.env.ABIDE_BENCH_THRESHOLD ?? 5)

const baseRef = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'HEAD'

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

// Run the bench harness at `cwd` and parse its JSON report (last JSON line of stdout).
async function runBenchAt(cwd: string): Promise<BenchReport> {
    const proc = Bun.spawn(['bun', 'run', 'bench/run.ts', '--json'], {
        cwd,
        stdout: 'pipe',
        stderr: 'inherit',
        env: process.env,
    })
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (code !== 0) throw new Error(`bench run at ${cwd} exited ${code}`)
    const line = out
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .at(-1)
    if (!line) throw new Error(`bench run at ${cwd} produced no JSON:\n${out}`)
    return JSON.parse(line) as BenchReport
}

async function benchBaseRef(): Promise<BenchReport> {
    const worktree = await mkdtemp(join(tmpdir(), 'abide-bench-'))
    const worktreePackage = join(worktree, 'packages', 'abide')
    try {
        await git(['worktree', 'add', '--detach', worktree, baseRef], REPO_ROOT)
        // node_modules is gitignored (absent in the fresh worktree); reuse this checkout's install.
        await symlink(join(REPO_ROOT, 'node_modules'), join(worktree, 'node_modules'), 'dir')
        await symlink(
            join(PACKAGE_DIR, 'node_modules'),
            join(worktreePackage, 'node_modules'),
            'dir',
        )
        // Run the CURRENT harness against the base library source.
        await rm(join(worktreePackage, 'bench'), { recursive: true, force: true })
        await cp(BENCH_DIR, join(worktreePackage, 'bench'), { recursive: true })
        return await runBenchAt(worktreePackage)
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
}

function collect(base: BenchReport, current: BenchReport): Row[] {
    const baseByName = new Map(base.scenarios.map((s) => [s.name, s]))
    const rows: Row[] = []
    const metrics: (keyof Omit<ScenarioResult, 'name'>)[] = ['render', 'mount', 'update']
    for (const cur of current.scenarios) {
        const b = baseByName.get(cur.name)
        if (!b) continue
        for (const metric of metrics) {
            const cm = cur[metric] as MetricResult | null
            const bm = b[metric] as MetricResult | null
            if (!cm || !bm) continue
            rows.push({
                label: `${cur.name} · ${metric}`,
                base: bm.nsPerOp,
                current: cm.nsPerOp,
                deltaPct: ((cm.nsPerOp - bm.nsPerOp) / bm.nsPerOp) * 100,
            })
        }
    }
    return rows
}

function fmtNs(ns: number): string {
    if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`
    if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`
    return `${ns.toFixed(0)} ns`
}

function flag(deltaPct: number): string {
    if (deltaPct > THRESHOLD) return '⚠ slower'
    if (deltaPct < -THRESHOLD) return '✓ faster'
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
            `${r.label.padEnd(labelWidth)}  ${fmtNs(r.base).padStart(10)}  ${fmtNs(r.current).padStart(10)}  ${`${sign}${r.deltaPct.toFixed(1)}%`.padStart(9)}  ${flag(r.deltaPct)}`,
        )
    }
    const regressions = rows.filter((r) => r.deltaPct > THRESHOLD).length
    const wins = rows.filter((r) => r.deltaPct < -THRESHOLD).length
    console.log(
        `\n${wins} faster · ${regressions} slower · ${rows.length - wins - regressions} within ±${THRESHOLD}%`,
    )
}

console.log(`benchmarking base ref: ${baseRef} …`)
const base = await benchBaseRef()
console.log('benchmarking working tree …')
const current = await runBenchAt(PACKAGE_DIR)
printDelta(collect(base, current))
