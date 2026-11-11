import type { batch, claimOf, emulatedDom, ratio } from '@abide/harness/report'

/**
 * The batcher as one IIFE's source, for a spec to add to its page with `addScriptTag`.
 *
 * Built in memory rather than into `dist/`: every harness spec loads in both engine projects at
 * once, and two workers writing one file is a reader that can catch it half-written.
 */
export async function reportScript(): Promise<string> {
    const built = await Bun.build({
        entrypoints: [
            new URL('../bench/reportInjectable.ts', import.meta.url).pathname,
        ],
        format: 'iife',
        target: 'browser',
    })
    if (!built.success)
        throw new AggregateError(built.logs, 'the batcher did not build')
    return (built.outputs[0] as Blob).text()
}

/** What `reportScript()` leaves on the page's `globalThis.__REPORT__`. */
export type Report = {
    batch: typeof batch
    claimOf: typeof claimOf
    emulatedDom: typeof emulatedDom
    ratio: typeof ratio
}
