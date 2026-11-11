// Builds one browser bench — `bench/<name>Injectable.ts` — into one file a page can be injected
// with, for a spec to `await buildBench('list')`. The harness's `buildInjectable.ts` is the same
// build over its MEASURE lane's entry; what keeps abide out of that lane is its entry's graph, not
// this file.
const OUT_DIR = new URL('../dist/', import.meta.url).pathname

/** Builds one entry into `dist/<name>.js`, an IIFE a page is injected with, and returns its path. */
export async function bundle(entry: string, name: string): Promise<string> {
    const built = await Bun.build({
        entrypoints: [entry],
        outdir: OUT_DIR,
        naming: `${name}.js`,
        format: 'iife',
        target: 'browser',
        minify: false,
    })
    if (!built.success)
        throw new AggregateError(built.logs, `${name} did not build`)
    return `${OUT_DIR}${name}.js`
}

/** Builds `scripts/<name>Injectable.ts` into `dist/<name>.js` and returns its path. */
export function buildBench(name: string): Promise<string> {
    return bundle(
        new URL(`./${name}Injectable.ts`, import.meta.url).pathname,
        name,
    )
}
