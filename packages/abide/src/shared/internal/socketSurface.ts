import type { Room } from './room.ts'

// The ISOMORPHIC face of a socket — everything a `.abide` can call, and nothing else.
//
// Split out of `server/socket.ts`'s `Socket` for the same reason ADR 0027 D10 split `RpcCallSurface`
// out of the rpc callable: the browser half cannot import `server/internal/` (ADR 0026), so while the
// only declaration lived there the client proxy was typed `unknown` and NOTHING checked it against the
// server's interface. It was free to be missing a probe, and was — a member added here would compile
// clean on both sides and fail at runtime as `chat.peek is not a function`.
//
// `Socket` is this plus `__socket`, the server-only transport handle (the mux, the MCP tail tool and
// the HTTP face reach through it). That member is exactly what the browser proxy has no business
// implementing, which is why the split runs here and not somewhere else.
export interface SocketSurface<T, Args = void> extends AsyncIterable<T> {
    // Subscribe to a room — a fresh replay-then-live cursor. A void socket also iterates directly
    // (`for await m of socket`); a roomed socket picks a room (`socket({room})`).
    (...room: Room<Args>): AsyncIterable<T>
    // Publish. Void: `publish(msg)`. Roomed: `publish({room}, msg)`.
    publish(...args: [...Room<Args>, message: T]): void
    // ACTIVE probes (client-sockets.md CS4.1) — reading these drives a subscription on the client.
    peek(...room: Room<Args>): T | undefined
    chunks(...room: Room<Args>): T[] | undefined
    // STATUS probes — observe the subscription lifecycle without driving it.
    pending(...room: Room<Args>): boolean
    refreshing(...room: Room<Args>): boolean
    done(...room: Room<Args>): boolean
    error(...room: Room<Args>): unknown | undefined
}

// The property members, with the call signature and the iterator dropped. Built by `Omit` rather than
// by listing names, so a probe ADDED to `SocketSurface` lands here automatically and the browser
// proxy's member object stops type-checking until it implements it. That is the whole point of the
// split — without it, "the client is missing a member" is a runtime discovery.
export type SocketSurfaceMembers<T, Args = void> = Omit<
    SocketSurface<T, Args>,
    typeof Symbol.asyncIterator
>
