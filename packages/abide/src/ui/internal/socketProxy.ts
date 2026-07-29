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

import { ChannelHub } from '../../shared/internal/channelHub.ts'
import { canonicalKey } from '../../shared/internal/codec.ts'
import { state } from '../../shared/internal/reactive.ts'
import { room } from '../../shared/internal/room.ts'
import { decodeMaxAge, type SocketSpec } from '../../shared/internal/socketSpec.ts'
import type { SocketSurface, SocketSurfaceMembers } from '../../shared/internal/socketSurface.ts'
import { muxPublish, muxSubscribe } from './mux.ts'

// The wire spec is declared in `shared/internal/socketSpec.ts`, beside the RPC one, so the encode and
// decode halves of `Infinity ↔ null` cannot be two expressions that merely happen to be inverses.
export type { SocketSpec }

// The reactive lifecycle state (CS4.1). `idle` = never subscribed / torn down (→ `done()`).
type Status = 'idle' | 'pending' | 'live' | 'refreshing' | 'error'

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
    // The pub/sub MECHANICS are the shared hub's, not a second copy: the bounded tail ring, the
    // maxAge-windowed latest, and the per-cursor FIFO fan-out all live in `ChannelHub`, which sits in
    // `shared/` precisely so one hub backs a channel on both sides. Re-deriving them here is how the
    // two came to disagree — this room used to size its per-cursor FIFO from `spec.tail`, fusing
    // replay depth with delivery capacity, so a `tail: 4` socket dropped a burst of 10 in the browser
    // and not on the server (ADR 0023 measured that fusion and rejected it: `[7,8,9,10]` vs `1..10`).
    // The hub keeps the two separate: `tail` bounds retention, each cursor keeps its own default FIFO.
    const hub = new ChannelHub<unknown>({
        tail: spec.tail,
        maxAge: decodeMaxAge(spec.maxAge),
    })
    const status = state<Status>('idle')
    // What this proxy genuinely ADDS over the hub: reactivity. The hub's retained state is plain BY
    // DESIGN — `server/socket.ts` records that the server's probes rest at their connected values
    // because probe liveness follows the TRANSPORT. So the transport half bumps one cell and the
    // probes read through it, rather than the hub growing a reactive shape the server does not want.
    const revision = state(0)
    // Live `{#for await}` cursors (CS3.2), retained only so `onError` can close them.
    const cursors = new Set<AsyncIterator<unknown>>()
    let errorValue: unknown
    let subscribed = false

    // Deliver one inbound message: retain + fan out through the hub, then wake the reactive probes.
    function deliver(message: unknown): void {
        hub.publish(message)
        revision.set(revision.untracked() + 1)
        if (status.untracked() !== 'error') status.set('live')
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
                    // `return()` is the hub's own detach: it unregisters the subscriber AND closes it,
                    // so a cursor cannot be closed while still in the hub's fan-out set.
                    for (const cursor of [...cursors]) void cursor.return?.()
                    cursors.clear()
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
        // ACTIVE probes — drive the subscription. Each reads `revision` FIRST so the caller subscribes
        // to the room even when the hub currently has nothing to hand back; the hub then applies the
        // same maxAge window (`peekLatest`) and tail bound (`tailSnapshot`) the server applies, lazily on
        // read (CS4.2) — no timer, so a static view may hold a stale value until the next reactive tick.
        peek(): unknown {
            ensureSubscribed()
            revision()
            return hub.peekLatest()
        },
        chunks(): unknown[] {
            ensureSubscribed()
            revision()
            return hub.tailSnapshot()
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
            // `replay: false` — a local cursor is live-only. The MUX subscription already asked the
            // server for the tail replay, and those messages arrive through `deliver`, so replaying the
            // hub's copy here would double every retained message into a fresh `{#for await}`.
            const cursor = hub.subscribe(false)
            cursors.add(cursor)
            return {
                next: (): Promise<IteratorResult<unknown>> => cursor.next(),
                return: (): Promise<IteratorResult<unknown>> => {
                    cursors.delete(cursor)
                    return cursor.return?.() ?? Promise.resolve({ value: undefined, done: true })
                },
            }
        },
    }
}

// The transport-boundary view of the isomorphic surface, erased the way `ErasedSocket` erases `Socket`
// on the server: this registry holds heterogeneous sockets, so both the message type and the room args
// go. `any` rather than `unknown` for the same reason given there — the contravariant positions make a
// concrete `SocketSurface<number, …>` unassignable to `SocketSurface<unknown, …>`.
// biome-ignore lint/suspicious/noExplicitAny: erased existential — mirrors `ErasedSocket` in server/socket.ts.
type ErasedSocketSurface = SocketSurface<any, any>

// The isomorphic `Socket<T, Args>` browser proxy: a CALLABLE that mirrors the server socket. A void
// socket uses the single (undefined) room — direct iteration + argless probes/`publish`. A roomed socket
// picks a room: `sock({room})` iterates it, `sock.peek({room})` / `sock.publish({room}, msg)` address it.
// One `RoomProxy` (⇒ one mux subscription) per distinct room, created lazily.
//
// Typed against `SocketSurface`, not `unknown`. While this returned `unknown` nothing checked the client
// half against the server's interface at all, so a probe added to the socket surface compiled clean on
// both sides and surfaced in the browser as `chat.peek is not a function`.
function makeSocketProxy(name: string, spec: SocketSpec, base: string): ErasedSocketSurface {
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
    // The room key is `room()` — the `Room` type's runtime twin, shared with `server/socket.ts` so the
    // two halves of the isomorphic surface cannot disagree about where the room sits in a call.
    const proxy = ((...r: unknown[]): AsyncIterable<unknown> => ({
        [Symbol.asyncIterator]: (): AsyncIterator<unknown> => roomFor(room(r)).iterate(),
    })) as Record<string, unknown> & ((...room: unknown[]) => AsyncIterable<unknown>)

    // Direct iteration (`for await m of socket`) subscribes the DEFAULT (void) room.
    ;(proxy as { [Symbol.asyncIterator]?: () => AsyncIterator<unknown> })[Symbol.asyncIterator] =
        () => roomFor(undefined).iterate()
    // publish(...): void → `[message]`; roomed → `[room, message]`. The message is always last.
    proxy.publish = (...args: unknown[]): void => {
        roomFor(room(args, 1)).publish(args[args.length - 1])
    }
    // Assigned as ONE typed object rather than member-by-member onto an untyped bag. `Omit`-derived, so
    // a probe added to `SocketSurface` appears here as a missing property and this stops compiling —
    // which is the only reason the surface type is worth having.
    const members: SocketSurfaceMembers<unknown, unknown> = {
        publish: proxy.publish as ErasedSocketSurface['publish'],
        peek: (...r: unknown[]): unknown => roomFor(room(r)).peek(),
        chunks: (...r: unknown[]): unknown[] => roomFor(room(r)).chunks(),
        pending: (...r: unknown[]): boolean => roomFor(room(r)).pending(),
        refreshing: (...r: unknown[]): boolean => roomFor(room(r)).refreshing(),
        done: (...r: unknown[]): boolean => roomFor(room(r)).done(),
        error: (...r: unknown[]): unknown => roomFor(room(r)).error(),
    }
    Object.assign(proxy, members)
    return proxy as unknown as ErasedSocketSurface
}

// Build the imports map injected into a page's client `$scope`: socket name → its client proxy
// (parallel to `makeClientImports` for RPC). The emitted mount reads these off `$scope` by the local
// name the page imported from `server/sockets/<name>.ts`.
export function makeClientSocketImports(
    specs: Record<string, SocketSpec>,
    base?: string,
): Record<string, ErasedSocketSurface> {
    const imports: Record<string, ErasedSocketSurface> = {}
    for (const [name, spec] of Object.entries(specs)) {
        imports[name] = makeSocketProxy(name, spec, base ?? '')
    }
    return imports
}
