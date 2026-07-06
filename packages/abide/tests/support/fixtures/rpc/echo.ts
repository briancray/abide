import { json } from '../../../../src/lib/server/json.ts'
import { defineRpc } from '../../../../src/lib/server/rpc/defineRpc.ts'

/* Server-side shape of `export const echo = GET(...)` after the bundler rewrite —
   a trivial rpc for routing tests. */
export const echo = defineRpc('GET', '/rpc/echo', async () => {
    return json({ ok: true })
})
