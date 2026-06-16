import { json } from '../../../../src/lib/server/json.ts'
import { defineVerb } from '../../../../src/lib/server/rpc/defineVerb.ts'

let calls = 0

/*
Server-side shape of `export const fastData = GET(...)` after the bundler
rewrite. Resolves immediately, so an awaited cache() read over it settles
during SSR render and ships inline in `__SSR__.cache`. The body carries the
call count so a test can detect an unexpected second handler run.
*/
export const fastData = defineVerb('GET', '/rpc/http-fast', () => {
    calls += 1
    return json({ n: calls })
})
