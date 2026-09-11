// Builds the measure lane into ONE file the browser arm is injected with. The bytes
// playwright injects and the bytes `bun test` imports have to be the same code, or
// the lane's one claim — the only lane in both substrates — is a claim about two
// different instruments.
const ENTRY = new URL('../src/measure/injectable.ts', import.meta.url).pathname
const OUT_DIR = new URL('../dist/', import.meta.url).pathname

export async function buildInjectable(): Promise<string> {
    const built = await Bun.build({
        entrypoints: [ENTRY],
        outdir: OUT_DIR,
        naming: 'measure.js',
        format: 'iife',
        target: 'browser',
        minify: false,
    })
    if (!built.success)
        throw new AggregateError(built.logs, 'harness/measure did not build')
    return `${OUT_DIR}measure.js`
}

if (import.meta.main) console.log(await buildInjectable())
