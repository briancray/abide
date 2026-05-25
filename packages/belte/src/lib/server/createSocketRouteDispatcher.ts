import type { ServerWebSocket } from 'bun'
import { log } from '../shared/log.ts'
import type { SocketClientFrame } from '../types/SocketClientFrame.ts'
import type { SocketFunction } from '../types/SocketFunction.ts'
import type { SocketRoutes } from '../types/SocketRoutes.ts'
import type { SocketServerFrame } from '../types/SocketServerFrame.ts'

type AnySocketFunction = SocketFunction<unknown, unknown>

type SocketRouteDispatcher = {
    open(ws: ServerWebSocket<unknown>): void
    message(ws: ServerWebSocket<unknown>, data: string | Buffer): void
    close(ws: ServerWebSocket<unknown>): void
}

/*
Per-connection state for the multiplexed socket-rpc channel: one Map of
active subscription id → AsyncIterator we're draining. Closing the ws
walks every active iterator and calls `.return()` so handler-side
`for await` loops exit through their normal `finally` blocks (releasing
DB cursors, watchers, etc.) — not as orphaned promises.
*/
type ConnectionState = {
    active: Map<string, AsyncIterator<unknown, unknown, unknown>>
}

/*
Bridges the framework's socket-route URL space to a single ws connection
per client. Receives `SocketClientFrame`s, looks the URL up in
SocketRoutes, invokes the handler via `.dispatch`, and pumps each
yielded value back as a `frame` carrying the same id. Cancellation flows
from the client via `close` → iterator `return()`, and from the server
via natural iterator return → `done` frame.

Errors are logged server-side with the full stack and sent back as a
`error` frame carrying only the message — the wire stays JSON-safe and
internal stack details never leave the server.

Module-level rpc lookups are cached per-URL once resolved so a hot
subscription URL doesn't re-import its module on every open.
*/
export function createSocketRouteDispatcher(rpc: SocketRoutes): SocketRouteDispatcher {
    const moduleCache = new Map<string, Promise<AnySocketFunction | undefined>>()
    const connections = new WeakMap<ServerWebSocket<unknown>, ConnectionState>()

    function loadHandler(url: string): Promise<AnySocketFunction | undefined> | undefined {
        const existing = moduleCache.get(url)
        if (existing) {
            return existing
        }
        const loader = rpc[url]
        if (!loader) {
            return undefined
        }
        const promise = loader().then((mod) => {
            for (const value of Object.values(mod)) {
                if (typeof value === 'function' && 'url' in value && 'dispatch' in value) {
                    return value as AnySocketFunction
                }
            }
            return undefined
        })
        moduleCache.set(url, promise)
        return promise
    }

    function send(ws: ServerWebSocket<unknown>, frame: SocketServerFrame): void {
        if (ws.readyState !== 1) {
            return
        }
        ws.send(JSON.stringify(frame))
    }

    async function pump(
        ws: ServerWebSocket<unknown>,
        state: ConnectionState,
        id: string,
        iterable: AsyncIterable<unknown>,
    ): Promise<void> {
        const iterator = iterable[Symbol.asyncIterator]()
        state.active.set(id, iterator)
        try {
            while (true) {
                const next = await iterator.next()
                if (next.done) {
                    send(ws, { type: 'done', id })
                    return
                }
                if (!state.active.has(id)) {
                    /*
                    Client cancelled mid-await; close() already called
                    iterator.return(). Skip the frame and exit — the
                    close path is responsible for the cleanup frame so
                    we don't race a second `done`.
                    */
                    return
                }
                send(ws, { type: 'frame', id, value: next.value })
            }
        } catch (error) {
            log.error(error)
            send(ws, {
                type: 'error',
                id,
                message: error instanceof Error ? error.message : String(error),
            })
        } finally {
            state.active.delete(id)
        }
    }

    return {
        open(ws) {
            connections.set(ws, { active: new Map() })
        },

        message(ws, data) {
            const state = connections.get(ws)
            if (!state) {
                return
            }
            const text = typeof data === 'string' ? data : data.toString('utf8')
            let frame: SocketClientFrame
            try {
                frame = JSON.parse(text) as SocketClientFrame
            } catch {
                return
            }
            if (frame.type === 'open') {
                const handlerPromise = loadHandler(frame.url)
                if (!handlerPromise) {
                    send(ws, {
                        type: 'error',
                        id: frame.id,
                        message: `[belte] no socket rpc registered at ${frame.url}`,
                    })
                    send(ws, { type: 'done', id: frame.id })
                    return
                }
                handlerPromise.then((handler) => {
                    if (!handler) {
                        send(ws, {
                            type: 'error',
                            id: frame.id,
                            message: `[belte] socket rpc module at ${frame.url} has no SOCKET export`,
                        })
                        send(ws, { type: 'done', id: frame.id })
                        return
                    }
                    pump(ws, state, frame.id, handler.dispatch(frame.args))
                })
                return
            }
            if (frame.type === 'close') {
                const iterator = state.active.get(frame.id)
                if (!iterator) {
                    return
                }
                state.active.delete(frame.id)
                iterator.return?.(undefined)?.catch((error) => log.error(error))
                send(ws, { type: 'done', id: frame.id })
            }
        },

        close(ws) {
            const state = connections.get(ws)
            if (!state) {
                return
            }
            connections.delete(ws)
            for (const iterator of state.active.values()) {
                iterator.return?.(undefined)?.catch((error) => log.error(error))
            }
            state.active.clear()
        },
    }
}
