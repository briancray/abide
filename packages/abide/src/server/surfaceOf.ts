import type { Method } from '#shared/rpc.ts'
import type { Mount, Mounted } from './answerRpc.ts'

/** A generated surface a handler may be listed on, besides the browser's (20.4 is the build's). */
export type Surface = 'mcp' | 'openapi' | 'cli'

/** A handler as a generated surface lists it. */
export type Listed = {
    address: string
    method: Method
    /** Its route without the leading `/` — what `call` spells it (38.8). */
    path: string
    /** What MCP and OpenAPI name it by. 20.13. */
    name: string
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
    // 16.71 — a private handler is its file's alone.
    if (mount.private) return undefined
    const live = 'handler' in mount ? mount : undefined
    // 16.37 — what its `clients` says, and the build's default where it says nothing.
    const carried =
        live?.handler.clients[surface] ??
        (surface === 'openapi' ? true : mount[surface])
    if (!carried) return undefined
    return {
        address: mount.address,
        method: mount.method,
        path: mount.address.slice(1),
        name: surfaceName(mount.method, mount.address),
        description:
            live === undefined ? mount.description : live.handler.description,
        schema: live === undefined ? mount.args : live.argsDocument,
    }
}

/**
 * A handler's name on MCP and OpenAPI: its method and its route, in the letters a tool's name admits.
 *
 * 20.13 — the method first, so two handlers at one route are two names, and a segment's brackets
 * and dots dropped, so `/media/[id]` reads `media_id` rather than `media__id_`.
 */
export function surfaceName(method: Method, route: string): string {
    return `${method.toLowerCase()}${route === '/' ? '' : route.replace(/[[\].]/g, '')}`.replace(
        /[^a-zA-Z0-9-]/g,
        '_',
    )
}
