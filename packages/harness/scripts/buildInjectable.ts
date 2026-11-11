// Builds the measure lane into ONE IIFE the browser arm is injected with. The bytes
// playwright injects and the bytes `bun test` imports have to be the same code, or
// the lane's one claim — the only lane in both substrates — is a claim about two
// different instruments.
//
// A spec injects the source with `addInitScript({ content })` and reads
// `__HARNESS_MEASURE__` off the page. Built in memory rather than into `dist/`: every
// spec loads in both engine projects at once, and two workers writing one file is a
// reader that can catch it half-written.

const ENTRY = new URL('../src/measure/injectable.ts', import.meta.url).pathname

/** Builds the measure lane's injectable and returns its source. */
export async function buildInjectable(): Promise<string> {
    const built = await Bun.build({
        entrypoints: [ENTRY],
        format: 'iife',
        target: 'browser',
        minify: false,
    })
    if (!built.success)
        throw new AggregateError(built.logs, 'measure did not build')
    return (built.outputs[0] as Blob).text()
}
