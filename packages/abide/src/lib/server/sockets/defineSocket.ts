import { createPushIterator } from '../../shared/createPushIterator.ts'
import { encodeRefJson } from '../../shared/encodeRefJson.ts'
import { resolveClientFlags } from '../../shared/resolveClientFlags.ts'
import { socketTapSlot } from '../../shared/socketTapSlot.ts'
import type { TailHooks } from '../../shared/types/TailHooks.ts'
import { getActiveServer } from '../runtime/getActiveServer.ts'
import { registerSocket } from './registerSocket.ts'
import type { Socket } from './types/Socket.ts'
import type { SocketOptions } from './types/SocketOptions.ts'
import type { SocketServerFrame } from './types/SocketServerFrame.ts'

/*
Server-side construction of a Socket. The bundler rewrites every
`export const NAME = socket(opts)` inside `src/server/sockets/<file>.ts` into
`__abideDefineSocket__("<name>", opts)` so the file path becomes the
socket's identity. Each subscriber gets its own queue + notifier, the
optional retained tail is shared, and outbound fan-out rides Bun's
native `server.publish` so connected ws clients are notified by the
runtime in C rather than per-client iteration in JS.

The Socket itself is the AsyncIterable: `for await (const m of chat)`
is the live stream — no replay. `chat.tail(count)` opens a subscription
seeded with the last `count` retained frames (no-arg = the whole
retained tail, clamped to the declared `tail` size). When `ttl` is set,
retained frames older than `ttl` ms are evicted lazily on every
read/append — no timer runs in the background. `chat.publish(m)` is isomorphic —
called server-side it both notifies in-process iterators and broadcasts
to remote subscribers; called client-side (via socketProxy) it sends a
`pub` frame the dispatcher validates and forwards.
*/
// @documentation plumbing
export function defineSocket<T>(name: string, opts: SocketOptions = {}): Socket<T> {
    /* Retention defaults to 1: the socket keeps its last frame so a late joiner, a
       reconnect, and `.peek()` all have the current value to seed from. Bare iteration
       still replays nothing (iterate(0) below) — a real-time `watch(socket, …)` reaction
       must see only live frames, never re-process the retained one. `tail: 0` opts out. */
    const retention = opts.tail ?? 1
    const ttl = opts.ttl
    const schema = opts.schema
    /*
    A schema makes the socket's payload safe to advertise to non-browser
    surfaces, so it flips mcp/cli on by default — exposing the `tail` read
    tool (and `publish` when clientPublish is set). Explicit `clients` wins.
    */
    const hasSchema = schema !== undefined
    const clients = resolveClientFlags(opts.clients, { mcp: hasSchema, cli: hasSchema })
    type BufferEntry = { value: T; expiresAt: number | undefined }
    const buffer: BufferEntry[] = []
    const subscribers = new Set<(message: T) => void>()
    const topic = `socket:${name}`

    /*
    Retained frames are stored with an expiry timestamp. When `ttl` is set,
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
    /*
    When a schema is attached, publish() validates synchronously and
    throws on bad payloads. Standard Schema's validate() is generally
    async — but for the synchronous server-side publish path we treat
    a Promise return as a programming error (publish must be sync to
    preserve in-process notify ordering). Schemas that need async
    refinement should pre-validate at the call site instead.
    */
    function validateSync(message: T): T {
        if (!schema) {
            return message
        }
        const result = schema['~standard'].validate(message)
        if (result instanceof Promise) {
            throw new Error(
                `[abide] socket "${name}" schema returned a Promise — sockets require sync validation`,
            )
        }
        if (result.issues) {
            throw new Error(
                `[abide] socket "${name}" publish payload failed validation: ${JSON.stringify(result.issues)}`,
            )
        }
        return result.value as T
    }
    function publish(message: T): void {
        const validated = validateSync(message)
        if (retention > 0) {
            const now = Date.now()
            pruneExpired(now)
            buffer.push({ value: validated, expiresAt: ttl === undefined ? undefined : now + ttl })
            if (buffer.length > retention) {
                buffer.shift()
            }
        }
        for (const notify of subscribers) {
            notify(validated)
        }
        // Observe the fanned-out frame (inspector); no-op when unobserved.
        socketTapSlot.tap?.({ socket: name, message: validated })
        if (cachedServer === undefined) {
            cachedServer = getActiveServer()
        }
        const server = cachedServer
        /* Remote fan-out is the only consumer of the encoded frame: in-process iterators
           already received the live object via notify() above. Skip the full message-graph
           walk (encodeRefJson) + native publish when zero ws clients are subscribed to the
           topic — subscriberCount is a cheap C-side check, encodeRefJson is not. */
        if (server && server.subscriberCount(topic) > 0) {
            /* Typed against the shared wire contract so a `SocketServerFrame` change can't
               silently drift from this construction site (the dispatcher's `send` is already
               typed; this was the last `msg` frame built through an unchecked JSON.stringify). */
            const frame: SocketServerFrame = { type: 'msg', socket: name, message: validated }
            // ref-json (matching the dispatcher + client) so a message graph with cycles/shared refs fans out intact.
            server.publish(topic, encodeRefJson(frame))
        }
    }

    /*
    replay === 'all' replays the whole retained tail (`.tail()` no-arg);
    a number replays the last min(count, buffer.length) items — `0` is
    live-only, the bare `for await` behavior. `hooks.replayed` is queued
    in-band after the replayed frames so a window reader commits its seed
    atomically, strictly before any live frame.
    */
    function iterate(replay: number | 'all', hooks?: TailHooks): AsyncIterable<T> {
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
                if (hooks?.replayed) {
                    iter.control(hooks.replayed)
                }
                subscriber = (message: T) => iter.push(message)
                subscribers.add(subscriber)
                return iter
            },
        }
    }

    const self: Socket<T> = {
        name,
        clients,
        publish,
        /* `broadcast` is the taught name for `publish` (server → all subscribers); publish
           stays as an alias through the migration. Same isomorphic fan-out. */
        broadcast: publish,
        tail: (count?: number, hooks?: TailHooks) => iterate(count ?? 'all', hooks),
        [Symbol.asyncIterator]: () => iterate(0)[Symbol.asyncIterator](),
    }
    registerSocket({
        socket: self as Socket<unknown>,
        allowClientPublish: opts.clientPublish ?? false,
        schema,
        clients,
        snapshotTail: (count?: number) => {
            pruneExpired(Date.now())
            /* A non-finite count (NaN/Infinity) would make slice() leak the whole
               buffer — treat it as absent (full tail), the same as count === undefined. */
            const start =
                count === undefined || !Number.isFinite(count)
                    ? 0
                    : Math.max(0, buffer.length - count)
            return buffer.slice(start).map((entry) => entry.value)
        },
    })
    return self
}
