// Builds the reactive bench into one file a page can be injected with. Same shape as
// `buildInjectable.ts`, and separate from it because that one builds the MEASURE lane,
// which has no abide in its graph and must keep not having one.
const ENTRY = new URL('./reactiveInjectable.ts', import.meta.url).pathname
const OUT_DIR = new URL('../dist/', import.meta.url).pathname

export async function buildReactiveInjectable(): Promise<string> {
    const built = await Bun.build({
        entrypoints: [ENTRY],
        outdir: OUT_DIR,
        naming: 'reactive.js',
        format: 'iife',
        target: 'browser',
        minify: false,
    })
    if (!built.success)
        throw new AggregateError(built.logs, 'the reactive bench did not build')
    return `${OUT_DIR}reactive.js`
}

if (import.meta.main) console.log(await buildReactiveInjectable())
