// Builds the measure lane into ONE file the browser arm is injected with. The bytes
// playwright injects and the bytes `bun test` imports have to be the same code, or
// the lane's one claim — the only lane in both substrates — is a claim about two
// different instruments.
import { bundle } from './buildBench.ts'

const ENTRY = new URL('../src/measure/injectable.ts', import.meta.url).pathname

/** Builds the measure lane's injectable into `dist/measure.js` and returns its path. */
export function buildInjectable(): Promise<string> {
    return bundle(ENTRY, 'measure')
}

if (import.meta.main) console.log(await buildInjectable())
