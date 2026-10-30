import { execFileSync } from 'node:child_process'

import type { batch, claimOf, emulatedDom, ratio } from '@abide/harness/report'

const REPO = new URL('../../../', import.meta.url).pathname

/**
 * The batcher as one IIFE's source, for a spec to add to its page with `addScriptTag`.
 *
 * Built in memory rather than into `dist/`: every harness spec loads in both engine projects at
 * once, and two workers writing one file is a reader that can catch it half-written.
 */
export function reportScript(): string {
    return execFileSync(
        'bun',
        [
            '-e',
            `
const built = await Bun.build({
    entrypoints: ['./packages/abide/bench/reportInjectable.ts'],
    format: 'iife',
    target: 'browser',
})
if (!built.success) throw new AggregateError(built.logs, 'the batcher did not build')
process.stdout.write(await built.outputs[0].text())
`,
        ],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
}

/** What `reportScript()` leaves on the page's `globalThis.__REPORT__`. */
export type Report = {
    batch: typeof batch
    claimOf: typeof claimOf
    emulatedDom: typeof emulatedDom
    ratio: typeof ratio
}
