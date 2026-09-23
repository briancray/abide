// Builds one browser bench — `scripts/<name>Injectable.ts` — into one file a page can be injected
// with: `bun scripts/buildBench.ts list`. `buildInjectable.ts` is the same build over the MEASURE
// lane's entry; what keeps abide out of that lane is its entry's graph, not this script.
const OUT_DIR = new URL('../dist/', import.meta.url).pathname

// One entry into `dist/<name>.js`, as an IIFE a page is injected with.
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

export function buildBench(name: string): Promise<string> {
    return bundle(
        new URL(`./${name}Injectable.ts`, import.meta.url).pathname,
        name,
    )
}

if (import.meta.main) {
    const name = Bun.argv[2]
    if (name === undefined)
        throw new Error(
            'usage: bun scripts/buildBench.ts <list|reactive|shapes|shared>',
        )
    console.log(await buildBench(name))
}
