import { json } from '../../../../src/lib/server/json.ts'
import { defineVerb } from '../../../../src/lib/server/rpc/defineVerb.ts'
import { slowGate } from './slowGate.ts'

/*
Server-side shape of `export const slowData = GET(...)` after the bundler
rewrite — the verb the streaming fixture page reads through cache() inside
{#await}, kept pending until the test releases the gate.
*/
export const slowData = defineVerb('GET', '/rpc/http-slow', async () => {
    slowGate.calls += 1
    await slowGate.current.opened
    return json({ n: slowGate.calls })
})
