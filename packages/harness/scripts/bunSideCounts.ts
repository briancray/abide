// The bun half of the both-substrates gate, printed as JSON so the playwright side can
// compare against it rather than against a second transcription of the same expectations.
// A process of its own because it registers happy-dom over the globals — `substrates.spec.ts`
// says why that cannot be the playwright worker's — and it registers them through the same
// preload `bun test` measures under.
import '../src/measure/preload.ts'

import { CASES } from '../e2e/CASES.ts'
import { measure, patchSet } from '../src/measure/index.ts'

/**
 * Each case's `Work` under bun, keyed by case name. Nothing publishes here, so `published` is
 * empty in both substrates and compares equal with the counts.
 */
const cases: Record<string, unknown> = {}
for (const [name, body] of Object.entries(CASES)) cases[name] = measure(body)

console.log(JSON.stringify({ patchSet: patchSet(), cases }))
