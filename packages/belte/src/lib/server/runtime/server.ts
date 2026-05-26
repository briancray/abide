import type { Server } from 'bun'
import { getActiveServer } from './getActiveServer.ts'

/*
Returns the active Bun.serve instance. Mirrors `request()`'s
function-call shape so call sites appear in stack traces (a Proxy
trap intermediates and obscures them). Throws if accessed before
Bun.serve has booted — silent undefined would mask the misuse and
strand later property reads with cryptic errors.
*/
export function server(): Server<unknown> {
    const active = getActiveServer()
    if (!active) {
        throw new Error(
            '[belte] server() called before init — make sure your call happens inside or after app.ts init() resolves',
        )
    }
    return active
}
