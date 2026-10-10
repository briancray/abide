import { RPC_ADDRESS } from '#shared/ADDRESSES.ts'
import type { Method } from '#shared/rpc.ts'
import type { Mount, Mounted } from './answerRpc.ts'

/** A generated surface a handler may be listed on, besides the browser's (20.4 is the build's). */
export type Surface = 'mcp' | 'openapi' | 'cli'

/** A handler as a generated surface lists it. */
export type Listed = {
    address: string
    method: Method
    /** Its address below `/__abide/rpc` — what `call` spells it (38.8), and every surface names it by. */
    path: string
    description: string | undefined
    /** Its args' JSON Schema, where it has one. 19.9, 20.11. */
    schema: unknown
}

/**
 * The handler as `surface` lists it, or `undefined` where the surface does not carry it.
 *
 * 20.1, 20.2, 20.3 — ONE PROJECTION FROM A HANDLER TO EVERY SURFACE. Withheld where its own
 * `clients` says so, and from MCP and the shell where it returns a `Response` and says nothing
 * (16.37). A MOUNTED handler is the app's, read off the
 * handler itself — its runtime `description`, and the schema probed at mount (20.11); a ROW is the
 * build's, which is all the command line holds of an app it may never have booted (38.7), read off
 * what the build wrote.
 */
export function surfaceOf(
    mount: Mount | Mounted,
    surface: Surface,
): Listed | undefined {
    const live = 'handler' in mount ? mount : undefined
    // 16.37 — what its `clients` says, and the build's default where it says nothing.
    const carried =
        live?.handler.clients[surface] ??
        (surface === 'openapi' ? true : mount[surface])
    if (!carried) return undefined
    return {
        address: mount.address,
        method: mount.method,
        path: mount.address.slice(RPC_ADDRESS.length + 1),
        description:
            live === undefined ? mount.description : live.handler.description,
        schema: live === undefined ? mount.args : live.argsDocument,
    }
}
