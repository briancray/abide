import { createPushIterator } from '../../shared/createPushIterator.ts'
import type { Socket } from './types/Socket.ts'
import type { SocketOptions } from './types/SocketOptions.ts'
import { getActiveServer } from '../runtime/getActiveServer.ts'
import { registerSocket } from './registerSocket.ts'

/*
Server-side construction of a Socket. The bundler rewrites every
`export const NAME = socket(opts)` inside `src/server/sockets/<file>.ts` into
`__belteDefineSocket__("<name>", opts)` so the file path becomes the
socket's identity. Each subscriber gets its own queue + notifier, the
optional history buffer is shared, and outbound fan-out rides Bun's
native `server.publish` so connected ws clients are notified by the
runtime in C rather than per-client iteration in JS.

The Socket itself is the AsyncIterable: `for await (const m of chat)`
replays the full history buffer then tails live. `chat.tail(count)`
opens a subscription that replays the last `count` items (default `0`,
clamped to the configured `history` max). When `ttl` is set, history
entries older than `ttl` ms are evicted lazily on every read/append —
no timer runs in the background. `chat.publish(m)` is isomorphic —
called server-side it both notifies in-process iterators and broadcasts
to remote subscribers; called client-side (via socketProxy) it sends a
`pub` frame the dispatcher validates and forwards.
*/
export function defineSocket<T>(name: string, opts: SocketOptions = {}): Socket<T> {
    const historySize = opts.history ?? 0
    const ttl = opts.ttl
    type BufferEntry = { value: T; expiresAt: number | undefined }
    const buffer: BufferEntry[] = []
    const subscribers = new Set<(message: T) => void>()
    const topic = `socket:${name}`

    /*
    History entries are stored with an expiry timestamp. When `ttl` is set,
    every read/append starts by dropping leading entries whose expiry has
    passed — entries are appended in order so the expired prefix is
    contiguous. No timer/setInterval is needed: expiry is lazy.
    */
    function pruneExpired(now: number): void {
        if (ttl === undefined) {
            return
        }
        let drop = 0
        for (const entry of buffer) {
            if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
                drop++
            } else {
                break
            }
        }
        if (drop > 0) {
            buffer.splice(0, drop)
        }
    }

    /*
    Active server is set once per process during createServer's boot,
    immediately after Bun.serve resolves, and never reassigned. Resolve
    it lazily on the first publish then keep the reference so subsequent
    publishes skip the per-call getter.
    */
    let cachedServer: ReturnType<typeof getActiveServer>
    function publish(message: T): void {
        if (historySize > 0) {
            const now = Date.now()
            pruneExpired(now)
            buffer.push({ value: message, expiresAt: ttl === undefined ? undefined : now + ttl })
            if (buffer.length > historySize) {
                buffer.shift()
            }
        }
        for (const notify of subscribers) {
            notify(message)
        }
        const server = cachedServer ?? (cachedServer = getActiveServer())
        if (server) {
            server.publish(topic, JSON.stringify({ type: 'msg', socket: name, message }))
        }
    }

    /*
    replay === 'all' replays the entire buffer (bare `for await`);
    a number replays the last min(count, buffer.length) items.
    */
    function iterate(replay: number | 'all'): AsyncIterable<T> {
        return {
            [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
                let subscriber: ((message: T) => void) | undefined
                const iter = createPushIterator<T>(() => {
                    if (subscriber) {
                        subscribers.delete(subscriber)
                    }
                })
                pruneExpired(Date.now())
                const replayCount =
                    replay === 'all' ? buffer.length : Math.min(replay, buffer.length)
                if (replayCount > 0) {
                    const start = buffer.length - replayCount
                    for (let index = start; index < buffer.length; index++) {
                        iter.push((buffer[index] as BufferEntry).value)
                    }
                }
                subscriber = (message: T) => iter.push(message)
                subscribers.add(subscriber)
                return iter
            },
        }
    }

    const self: Socket<T> = {
        name,
        publish,
        tail: (count = 0) => iterate(count),
        [Symbol.asyncIterator]: () => iterate('all')[Symbol.asyncIterator](),
    }
    registerSocket({
        socket: self as Socket<unknown>,
        allowClientPublish: opts.clientPublish ?? false,
        snapshotHistory: () => {
            pruneExpired(Date.now())
            return buffer.map((entry) => entry.value)
        },
    })
    return self
}
