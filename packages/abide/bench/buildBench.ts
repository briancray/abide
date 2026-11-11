// Builds one browser bench — `bench/<name>Injectable.ts` — into one IIFE's source a page can be
// injected with, for a spec to `await buildBench('list')`. The harness's `buildInjectable.ts` is the
// same build over its MEASURE lane's entry; what keeps abide out of that lane is its entry's graph,
// not this file.
//
// Built in memory rather than into `dist/`: every spec loads in both engine projects at once, and
// two workers writing one file is a reader that can catch it half-written.

/** Builds `bench/<name>Injectable.ts` into an IIFE and returns its source. */
export async function buildBench(name: string): Promise<string> {
    const built = await Bun.build({
        entrypoints: [
            new URL(`./${name}Injectable.ts`, import.meta.url).pathname,
        ],
        format: 'iife',
        target: 'browser',
        minify: false,
    })
    if (!built.success)
        throw new AggregateError(built.logs, `${name} did not build`)
    return (built.outputs[0] as Blob).text()
}
