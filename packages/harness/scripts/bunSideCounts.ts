// The bun half of the both-substrates gate, printed as JSON so the playwright side —
// which runs on node and cannot import a lane — can compare against it rather than
// against a second transcription of the same expectations.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { CASES } from '../e2e/CASES.ts'

GlobalRegistrator.register({ url: 'http://localhost/' })
const { install, measure, patchSet } = await import('../src/measure/index.ts')
install()

// `number | null` rather than `number`: the three rows this lane reads off the published
// counter are absent in both substrates here, and 44.23 says absent is `null`. Typed as
// `number` the two sides would still compare equal and the declaration would be a lie.
const cases: Record<string, Record<string, number | null>> = {}
for (const [name, body] of Object.entries(CASES))
    cases[name] = measure(body) as unknown as Record<string, number | null>

console.log(JSON.stringify({ patchSet: patchSet(), cases }))
