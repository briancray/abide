import type { Server } from 'bun'
import { getActiveServer } from './runtime/getActiveServer.ts'
import { inProcessServer } from './runtime/inProcessServer.ts'
import { requestContext } from './runtime/requestContext.ts'

/*
Returns the active Bun.serve instance. Mirrors `request()`'s function-call
shape so call sites appear in stack traces (a Proxy trap intermediates and
obscures them).

When no Bun.serve has booted, resolution forks on the request scope:
- Inside a scope it is in-process dispatch (CLI / MCP / test client), which
  never boots a server — return the no-op inProcessServer so handler idioms
  (server().timeout/publish/requestIP …) run unchanged instead of throwing.
  createServer sets the slot at boot before any request, so an empty slot
  while a scope is live can only be in-process.
- Outside any scope it is a genuine before-init misuse (module top-level /
  app.ts init); keep throwing — silent undefined would mask it and strand
  later property reads with cryptic errors.
*/
// @readme request-scope
export function server(): Server<unknown> {
    const active = getActiveServer()
    if (active) {
        return active
    }
    if (requestContext.getStore()) {
        return inProcessServer
    }
    throw new Error(
        '[abide] server() called before init — make sure your call happens inside or after app.ts init() resolves',
    )
}
