import type { ReactiveProbeSurface } from './reactiveReadSurface.ts'
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
// The six probes are INHERITED from `ReactiveProbeSurface` rather than re-listed here. They were
// hand-copied, and this interface extended nothing — the exact rot ADR 0027 names, surviving at the
// type level after D4 fixed the runtime half: a probe added to the shared surface reached `Memo` and
// `Channel` and silently did NOT reach a socket, on either side. Only `chunks` is re-stated, to narrow
// the shared `unknown[]` to `T[]` (a channel's transcript IS its messages), which is the same legal
// covariant override `Channel` makes for the same reason.
//
// What is NOT inherited is deliberate: `refresh`/`invalidate`/`watch` live on `ReactiveReadSurface`,
// one level up, and a socket implements none of them — `server/socket.ts` and `ui/internal/socketProxy.ts`
// each assign exactly seven members. Folding the verbs in would widen the public surface with three
// members nothing implements, which is a feature decision, not a unification.
export interface SocketSurface<T, Args = void>
    extends AsyncIterable<T>,
        ReactiveProbeSurface<Args, T> {
    // Subscribe to a room — a fresh replay-then-live cursor. A void socket also iterates directly
    // (`for await m of socket`); a roomed socket picks a room (`socket({room})`).
    (...room: Room<Args>): AsyncIterable<T>
    // Publish. Void: `publish(msg)`. Roomed: `publish({room}, msg)`. A TRAILING payload, so this one
    // genuinely needs the `Room` spread — the key is not last.
    publish(...args: [...Room<Args>, message: T]): void
    // Narrows the shared `chunks(): unknown[] | undefined` to the message type. ACTIVE probe
    // (client-sockets.md CS4.1) — reading it drives a subscription on the client, as `peek` does.
    chunks(args: Args): T[] | undefined
}

// The property members, with the call signature and the iterator dropped. Built by `Omit` rather than
// by listing names, so a probe ADDED to `SocketSurface` lands here automatically and the browser
// proxy's member object stops type-checking until it implements it. That is the whole point of the
// split — without it, "the client is missing a member" is a runtime discovery.
export type SocketSurfaceMembers<T, Args = void> = Omit<
    SocketSurface<T, Args>,
    typeof Symbol.asyncIterator
>
