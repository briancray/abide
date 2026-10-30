// The bun half of the both-substrates gate, printed as JSON so the playwright side —
// which runs on node and cannot import a lane — can compare against it rather than
// against a second transcription of the same expectations.
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { CASES } from '../e2e/CASES.ts'

GlobalRegistrator.register({ url: 'http://localhost/' })
const { install } = await import('../src/measure/install.ts')
const { measure, patchSet } = await import('../src/measure/index.ts')
install()

/**
 * Each case's `Work` under bun, keyed by case name. Nothing publishes here, so `published` is
 * empty in both substrates and compares equal with the counts.
 */
const cases: Record<string, unknown> = {}
for (const [name, body] of Object.entries(CASES)) cases[name] = measure(body)

console.log(JSON.stringify({ patchSet: patchSet(), cases }))
