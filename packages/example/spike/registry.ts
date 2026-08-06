// The server's side of the address: id -> handler, and the routes that dispatch by it.
//
// Nothing here is discovered by scanning the filesystem. The plugin appends a `register(...)` call
// to every transport module it loads, so a handler is reachable exactly when its module was imported
// — the same rule the runtime already follows for scoped `<style>` blocks.

import type { Channel, KeyedMemo } from 'abide'
import type { Server, ServerWebSocket } from 'bun'
import type { Kind } from './ids.ts'
import { ABIDE_PREFIX, RPC_PREFIX, SOCKET_PREFIX } from './PATHS.ts'

type Reader = KeyedMemo<unknown, unknown>
type Stream = Channel<unknown>

const RPCS = new Map<string, Reader>()
const SOCKETS = new Map<string, Stream>()

export function register(
    kind: Kind,
    entries: [id: string, name: string][],
    module: Record<string, unknown>,
): void {
    const into = kind === 'rpc' ? RPCS : SOCKETS
    for (const [id, name] of entries) into.set(id, module[name] as Reader & Stream)
}

export function registered(kind: Kind): string[] {
    return [...(kind === 'rpc' ? RPCS : SOCKETS).keys()]
}

// A call from another origin is a PREFLIGHT before it is ever a call, so the mount point answers one
// or nothing else works. Open here because the spike has no `crossOrigin` option yet; the spec
// closes it by default, and that is a policy on top of this shape, not a different shape.
const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
}

interface SocketData {
    id: string
    unsubscribe: (() => void) | null
}

/**
 * The one entry point. Returns `undefined` for anything outside the reserved prefix, which is what
 * lets an app mount it in front of its own routes and never think about it again.
 */
export async function dispatch(request: Request, server: Server<SocketData>): Promise<Response | undefined> {
    const path = new URL(request.url).pathname
    if (!path.startsWith(ABIDE_PREFIX)) return undefined

    if (path.startsWith(SOCKET_PREFIX)) {
        const id = path.slice(SOCKET_PREFIX.length)
        if (!SOCKETS.has(id)) return new Response(`no socket ${id}`, { status: 404, headers: CORS })
        // The upgrade IS the subscribe; `open` below attaches it to the channel.
        const data: SocketData = { id, unsubscribe: null }
        if (server.upgrade(request, { data })) return undefined
        return new Response('upgrade failed', { status: 400, headers: CORS })
    }

    if (!path.startsWith(RPC_PREFIX))
        return new Response(`unknown abide path ${path}`, { status: 404, headers: CORS })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (request.method !== 'POST') return new Response('rpc is POST', { status: 405, headers: CORS })

    const id = path.slice(RPC_PREFIX.length)
    const handler = RPCS.get(id)
    if (handler === undefined) return new Response(`no endpoint ${id}`, { status: 404, headers: CORS })

    const args = await request.json()
    try {
        // `await` on the slot is the server reading its own memo — coalescing, retention and
        // newest-write-wins come from the cell, not from anything written here.
        return Response.json(await handler(args), { headers: CORS })
    } catch (error) {
        return new Response(String(error), { status: 500, headers: CORS })
    }
}

/** The websocket half of the mount point, handed straight to `Bun.serve({ websocket })`. */
export const websocket = {
    open(connection: ServerWebSocket<SocketData>): void {
        const stream = SOCKETS.get(connection.data.id)
        if (stream === undefined) {
            connection.close()
            return
        }
        // This is the entire socket transport: one subscribe. Everything a channel already does —
        // tail, fan-out, the reactive read — is untouched by it being remote.
        connection.data.unsubscribe = stream.subscribe((message) => connection.send(JSON.stringify(message)))
    },
    close(connection: ServerWebSocket<SocketData>): void {
        connection.data.unsubscribe?.()
        connection.data.unsubscribe = null
    },
    message(): void {
        // `clientPublish` is the spec's answer to the other direction, and it is a policy decision
        // (may a client publish, and what happens to what it sends) rather than plumbing. Not built.
    },
}
