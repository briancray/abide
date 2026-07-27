// CLIENT SOCKET PROXY (client-sockets.md CS1/CS3/CS4) — the browser half of the isomorphic `Socket`.
//
// The build swaps a `server/sockets/<name>.ts` import for one of these proxies (parallel to the RPC
// module-swap, rpc-core §6): same `Socket<T>` surface — `for await` + `publish` + the reactive
// memo-probe vocabulary — reached over the shared WS mux instead of an in-proc hub. Fan-out is local:
// ONE mux subscription per socket name, many local `Subscriber` iterators (CS3). The probes are
// backed by reactive `state`s so `{chat.peek()}` / `{#if chat.pending()}` re-render on change.
//
// ACTIVE probes (iterate / `peek` / `chunks`) open the subscription; STATUS probes (`pending` /
// `refreshing` / `done` / `error`) only observe it (CS11). `publish` is fire-and-forget (CS3.4).

import { canonicalKey } from '../../shared/internal/codec.ts'
import { state } from '../../shared/internal/reactive.ts'
import { Subscriber } from '../../shared/internal/subscriber.ts'
import { muxPublish, muxSubscribe } from './mux.ts'

// The per-socket spec shipped in the client bundle (client-sockets.md CS7). `tail` sizes the
// `chunks()` cap; `ttl` windows `peek()`; `clientPublish` gates `.publish()`.
export interface SocketSpec {
    clientPublish: boolean
    tail: number
    // Milliseconds, or `null` for Infinity/sticky (JSON can't carry Infinity, so it serialises to null).
    ttl: number | null
}

// The reactive lifecycle state (CS4.1). `idle` = never subscribed / torn down (→ `done()`).
type Status = 'idle' | 'pending' | 'live' | 'refreshing' | 'error'

interface LatestEntry {
    value: unknown
    time: number
}

// One ROOM's client state + reactive probes, backed by a single mux subscription (client-sockets.md
// CS3/CS4). A void socket has exactly one room (`args: undefined`); a roomed socket lazily makes one per
// distinct room key. Same shape the server socket exposes per hub.
interface RoomProxy {
    publish(message: unknown): void
    peek(): unknown
    chunks(): unknown[]
    pending(): boolean
    refreshing(): boolean
    done(): boolean
    error(): unknown
    iterate(): AsyncIterator<unknown>
}

function makeRoomProxy(name: string, args: unknown, spec: SocketSpec, base: string): RoomProxy {
    const cap = spec.tail > 0 ? spec.tail : 1024
    const status = state<Status>('idle')
    const latest = state<LatestEntry | undefined>(undefined)
    const chunks = state<unknown[]>([])
    // Local iterator fan-out: one Subscriber per live `{#for await}` cursor (CS3.2). Late cursors get
    // live-only (no local tail replay).
    const localSubs = new Set<Subscriber<unknown>>()
    let errorValue: unknown
    let subscribed = false

    // Deliver one inbound message: update the reactive latest/chunks, mark live, fan out to iterators.
    function deliver(message: unknown): void {
        latest.set({ value: message, time: Date.now() })
        const next = chunks.untracked().concat([message])
        if (next.length > cap) next.splice(0, next.length - cap)
        chunks.set(next)
        if (status.untracked() !== 'error') status.set('live')
        for (const sub of localSubs) sub.push(message)
    }

    // Open the ONE mux subscription (idempotent). Reading an ACTIVE probe drives this (CS11). We always
    // request the tail replay: a client-only subscription (a `bind:element` iterator, a soft-nav mount)
    // paints nothing during SSR, so it MUST catch up on the tail — and a reconnect must too (CS2.4). The
    // CS5/CS8 `replay: false` hydration join (for a socket whose `{#for await}` the SERVER already
    // painted, to avoid a double-render) is deferred to the stream-handoff integration — see the spec.
    function ensureSubscribed(): void {
        if (subscribed) return
        subscribed = true
        status.set('pending')
        muxSubscribe(
            name,
            {
                name,
                args,
                replay: true,
                onMessage: deliver,
                onAck: (): void => {
                    if (status.untracked() !== 'error') status.set('live')
                },
                onError: (error: unknown): void => {
                    errorValue = error
                    status.set('error')
                    for (const sub of localSubs) sub.close()
                },
                onReconnecting: (): void => {
                    if (status.untracked() === 'live') status.set('refreshing')
                },
            },
            base,
        )
    }

    return {
        publish(message: unknown): void {
            // Local programmer-error gate (CS3.4) — clearer than the server's silent 403-drop.
            if (!spec.clientPublish) {
                throw new Error(`socket "${name}": client publish is disabled (clientPublish)`)
            }
            muxPublish(name, message, base, args)
        },
        // ACTIVE probes — drive the subscription.
        peek(): unknown {
            ensureSubscribed()
            const entry = latest()
            if (entry === undefined) return undefined
            // Lazy `ttl` window on read (CS4.2): no timer, so a static view may hold a stale value
            // until the next reactive tick. `ttl: null` (Infinity, the default) → sticky.
            if (spec.ttl !== null && Date.now() - entry.time > spec.ttl) return undefined
            return entry.value
        },
        chunks(): unknown[] {
            ensureSubscribed()
            return chunks()
        },
        // STATUS probes — observe only (CS11), never open a subscription.
        pending(): boolean {
            return status() === 'pending'
        },
        refreshing(): boolean {
            return status() === 'refreshing'
        },
        done(): boolean {
            return status() === 'idle'
        },
        error(): unknown {
            return status() === 'error' ? errorValue : undefined
        },
        iterate(): AsyncIterator<unknown> {
            ensureSubscribed()
            const sub = new Subscriber<unknown>(cap)
            localSubs.add(sub)
            return {
                next: (): Promise<IteratorResult<unknown>> => sub.next(),
                return: (): Promise<IteratorResult<unknown>> => {
                    localSubs.delete(sub)
                    sub.close()
                    return Promise.resolve({ value: undefined, done: true })
                },
            }
        },
    }
}

// The isomorphic `Socket<T, Args>` browser proxy: a CALLABLE that mirrors the server socket. A void
// socket uses the single (undefined) room — direct iteration + argless probes/`publish`. A roomed socket
// picks a room: `sock({room})` iterates it, `sock.peek({room})` / `sock.publish({room}, msg)` address it.
// One `RoomProxy` (⇒ one mux subscription) per distinct room, created lazily.
function makeSocketProxy(name: string, spec: SocketSpec, base: string): unknown {
    const rooms = new Map<string, RoomProxy>()
    const roomFor = (args: unknown): RoomProxy => {
        const key = canonicalKey(args)
        let room = rooms.get(key)
        if (room === undefined) {
            room = makeRoomProxy(name, args, spec, base)
            rooms.set(key, room)
        }
        return room
    }
    // A probe call's room key: void → undefined (0 room args), roomed → the sole room arg.
    const roomArg = (r: unknown[]): unknown => (r.length > 0 ? r[0] : undefined)

    const proxy = ((...room: unknown[]): AsyncIterable<unknown> => ({
        [Symbol.asyncIterator]: (): AsyncIterator<unknown> => roomFor(roomArg(room)).iterate(),
    })) as Record<string, unknown> & ((...room: unknown[]) => AsyncIterable<unknown>)

    // Direct iteration (`for await m of socket`) subscribes the DEFAULT (void) room.
    ;(proxy as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> })[Symbol.asyncIterator] =
        () => roomFor(undefined).iterate()
    // publish(...): void → `[message]`; roomed → `[room, message]`. The message is always last.
    proxy.publish = (...args: unknown[]): void => {
        const message = args[args.length - 1]
        const room = args.length > 1 ? args[0] : undefined
        roomFor(room).publish(message)
    }
    proxy.peek = (...r: unknown[]): unknown => roomFor(roomArg(r)).peek()
    proxy.chunks = (...r: unknown[]): unknown[] => roomFor(roomArg(r)).chunks()
    proxy.pending = (...r: unknown[]): boolean => roomFor(roomArg(r)).pending()
    proxy.refreshing = (...r: unknown[]): boolean => roomFor(roomArg(r)).refreshing()
    proxy.done = (...r: unknown[]): boolean => roomFor(roomArg(r)).done()
    proxy.error = (...r: unknown[]): unknown => roomFor(roomArg(r)).error()
    return proxy
}

// Build the imports map injected into a page's client `$scope`: socket name → its client proxy
// (parallel to `makeClientImports` for RPC). The emitted mount reads these off `$scope` by the local
// name the page imported from `server/sockets/<name>.ts`.
export function makeClientSocketImports(
    specs: Record<string, SocketSpec>,
    base?: string,
): Record<string, unknown> {
    const imports: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(specs)) {
        imports[name] = makeSocketProxy(name, spec, base ?? '')
    }
    return imports
}
