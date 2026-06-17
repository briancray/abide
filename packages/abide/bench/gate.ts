import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
Benchmark regression gate. Runs every `*.bench.ts` in this directory as a fresh
subprocess, scrapes the `##METRIC <name> <value> <unit>` lines they emit, and
compares each against the committed baseline (`baseline.json`). Every metric is a
time — lower is better — so a regression is any metric that exceeds its baseline
by more than the tolerance. Run:

  bun packages/abide/bench/gate.ts            # check against baseline, fail on regression
  bun packages/abide/bench/gate.ts --update   # rewrite baseline from this run

Bench numbers vary by machine, so the tolerance is deliberately generous — this
gate catches a 1.4× blow-up from a bad data-structure choice, not 5% JIT noise.
The CI runner records its own baseline once on a representative machine; the gate
is about direction, not absolute truth. "Fast as fuck" only stays true if a number
guards it.
*/

const TOLERANCE = 1.4
const here = dirname(fileURLToPath(import.meta.url))
/* `BENCH_BASELINE` lets CI point the baseline at a temp file it produced from the
   merge base on the same runner — comparing head against base on one machine,
   which is the only way these numbers mean anything across heterogeneous runners.
   Locally it defaults to the committed baseline.json. */
const baselinePath = process.env.BENCH_BASELINE ?? join(here, 'baseline.json')

/* The benches the gate runs. coldStart spawns its own children, so it is the slow
   one; the rest are in-process loops. */
const benches = [
    'reactivityGraph.bench.ts',
    'listChurn.bench.ts',
    'mount.bench.ts',
    'ssr.bench.ts',
    'hydrate.bench.ts',
    'coldStart.bench.ts',
]

type Metric = { value: number; unit: string }

/* Runs one bench and returns its emitted metrics keyed by name. */
async function runBench(file: string): Promise<Record<string, Metric>> {
    const child = Bun.spawn(['bun', join(here, file)], { stdout: 'pipe', stderr: 'inherit' })
    const output = await new Response(child.stdout).text()
    if ((await child.exited) !== 0) {
        throw new Error(`${file} exited non-zero`)
    }
    const metrics: Record<string, Metric> = {}
    for (const line of output.split('\n')) {
        const match = line.match(/^##METRIC (\S+) (\S+) (\S+)$/)
        if (match) {
            metrics[match[1] as string] = { value: Number(match[2]), unit: match[3] as string }
        }
    }
    return metrics
}

const measured: Record<string, Metric> = {}
for (const file of benches) {
    console.log(`running ${file}…`)
    Object.assign(measured, await runBench(file))
}

const update = process.argv.includes('--update')
if (update) {
    await Bun.write(baselinePath, `${JSON.stringify(measured, undefined, 4)}\n`)
    console.log(`\nbaseline written: ${Object.keys(measured).length} metrics → baseline.json`)
    process.exit(0)
}

const baselineFile = Bun.file(baselinePath)
if (!(await baselineFile.exists())) {
    console.error('\nno baseline.json — run `bun bench/gate.ts --update` first')
    process.exit(1)
}
const baseline = (await baselineFile.json()) as Record<string, Metric>

let regressed = false
console.log('\nmetric                          baseline      current     ratio')
for (const [name, base] of Object.entries(baseline)) {
    const current = measured[name]
    if (current === undefined) {
        console.error(`  ${name.padEnd(28)} MISSING from this run`)
        regressed = true
        continue
    }
    const ratio = current.value / base.value
    const flag = ratio > TOLERANCE ? '  ✗ REGRESSION' : ''
    if (ratio > TOLERANCE) {
        regressed = true
    }
    console.log(
        `${name.padEnd(30)} ${base.value.toFixed(3).padStart(10)} ${current.value
            .toFixed(3)
            .padStart(11)} ${ratio.toFixed(2).padStart(8)}×${flag}`,
    )
}

if (regressed) {
    console.error(`\nFAIL: a metric regressed beyond ${TOLERANCE}× baseline`)
    process.exit(1)
}
console.log(`\nPASS: all metrics within ${TOLERANCE}× baseline`)
