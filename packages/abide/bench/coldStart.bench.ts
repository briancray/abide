import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitMetric } from './emitMetric.ts'

/*
Cold-start benchmark: the boot path a user actually waits on for first byte —
Bun process start, module-graph init, first compile, first render. Measured by
spawning a fresh `bun` per sample running the worker below, so nothing is warm
across samples (a single in-process loop would amortize boot away, hiding exactly
what this measures). Run:

  bun packages/abide/bench/coldStart.bench.ts

The companion worker (coldStartWorker.ts) imports the SSR compiler + reactive
runtime, compiles a real list page, and renders it once.
*/

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, 'coldStartWorker.ts')

async function sample(): Promise<number> {
    const start = performance.now()
    const child = Bun.spawn(['bun', worker], { stdout: 'ignore', stderr: 'pipe' })
    const code = await child.exited
    const elapsed = performance.now() - start
    if (code !== 0) {
        throw new Error(`worker exited ${code}: ${await new Response(child.stderr).text()}`)
    }
    return elapsed
}

const SAMPLES = 12
const timings: number[] = []
/* Two unmeasured warm spawns prime the filesystem cache so the run reflects steady
   cold start, not first-ever disk reads. */
await sample()
await sample()
for (let pass = 0; pass < SAMPLES; pass += 1) {
    timings.push(await sample())
}

timings.sort((a, b) => a - b)
const median = timings[Math.floor(timings.length / 2)] as number
const min = timings[0] as number
console.log('\ncold start — spawn → compile → first render (fresh bun each sample)\n')
console.log(`min     ${min.toFixed(1).padStart(8)}ms`)
console.log(`median  ${median.toFixed(1).padStart(8)}ms`)
console.log(`samples ${SAMPLES}\n`)
emitMetric('coldStart.median', median, 'ms')
