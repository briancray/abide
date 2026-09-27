// SECTION 18 — A VALUE CARRIED OVER A WEB SOCKET. `socket` declares one over a `reactive` or a `Keyed`
// (18.1), and the call hands back that value's own `Reactive` for the args, as `GET` does (16.3). On a
// server the call reaches the value itself; a browser is handed `socketWire` in its place, whose call
// is a subscriber's copy fed over the one mux every socket shares (18.2).
//
// PROCESS-WIDE (9.16): a value built with `global` (11.34), refused otherwise (18.18), so a publish
// inside a request reaches the one every subscriber is fed from rather than a copy filed under it.

import type { Failed } from './Failed.ts'
import { compose, type Middleware } from './Middleware.ts'
import { isKeyed, type Keyed, type Reactive } from './reactive/index.ts'
import type { PatchOp } from './reactive/PATCH_SINKS.ts'
import { isForwarder } from './reactive/scoped.ts'
import type { Clients } from './rpc.ts'

export type SocketEvent<Produced = unknown, Args = unknown> = {
    kind: 'subscribe' | 'publish'
    args: Args
    message?: Produced
    request: Request
}

// 18.9 — no schema: shape is the value's own (16.27).
export type SocketOptions<Produced = unknown, Args = unknown> = {
    middleware?: Middleware<SocketEvent<Produced, Args>, void>[]
    crossOrigin?: boolean | string[]
    clientPublish?: boolean
    clients?: Clients
}

// 18.2 — WHAT A BROWSER SENDS OVER THE MUX: a subscription — a socket's, resumed where `seq` is
// given (18.13), or a handler's naming the version it holds (18.17) — its end, or a publish (18.6).
export type BrowserFrame = {
    op: 'sub' | 'unsub' | 'pub'
    id: number
    address?: string
    args?: unknown
    seq?: number | undefined
    epoch?: string | undefined
    version?: number | undefined
    message?: unknown
}

// AND WHAT IT IS SENT: a production (9.14), the owner's ring (18.14), a refusal as the four fields it
// is, a handler's value where it moved (18.21), what patches wrote over `base` (18.26), and a
// handler's trigger per match (7.10, 7.18).
export type ServerFrame = {
    op:
        | 'prod'
        | 'reset'
        | 'error'
        | 'value'
        | 'patch'
        | 'invalidate'
        | 'refresh'
    id: number
    seq?: number
    epoch?: string
    version?: number
    base?: number
    ops?: PatchOp[]
    value?: unknown
    ring?: [number, unknown][]
    error?: Failed<string, unknown>
}

export type Socket<Produced, Args, Failures = never> = ((
    ...args: undefined extends Args ? [args?: Args] : [args: Args]
) => Reactive<Produced, Produced, Failures, Produced>) & {
    // What the server feeds subscribers from, and what the mux reaches for a subscription.
    values:
        | Reactive<Produced, Produced, Failures, Produced>
        | Keyed<Produced, Args, Produced, Failures, Produced>
    // 18.3, 18.4 — the rungs, composed once at the declaration (16.15), and `null` where there are
    // none, so a frame through a socket with no rungs awaits nothing.
    onion: ((event: SocketEvent<Produced, Args>) => Promise<void>) | null
    crossOrigin: boolean | string[]
    // 18.6.
    clientPublish: boolean
    clients: Clients
    address: string | undefined
}

export function socket<Produced, Args = undefined, Failures = never>(
    values?:
        | Reactive<Produced, Produced, Failures, Produced>
        | Keyed<Produced, Args, Produced, Failures, Produced>,
    options?: SocketOptions<Produced, Args>,
): Socket<Produced, Args, Failures> {
    if (values === undefined)
        throw new Error(
            'abide: socket() was given no value to carry. Hand it a reactive, or a keyed one.',
        )
    if (isForwarder(values))
        throw new Error(
            'abide: socket() was handed a value built without `global`, which is request-local on a server. Build it with `reactive(…, { global: true })`. RULEBOOK 9.16, 18.18.',
        )
    // 18.1 — the value's own `Reactive` for these args.
    const call = (args?: Args): unknown =>
        isKeyed(values)
            ? (values as (args: Args) => unknown)(args as Args)
            : values
    const rungs = options?.middleware ?? []
    return Object.assign(call, {
        values,
        onion: rungs.length === 0 ? null : compose(rungs, async () => {}),
        crossOrigin: options?.crossOrigin ?? false,
        clientPublish: options?.clientPublish ?? false,
        clients: options?.clients ?? {},
        address: undefined as string | undefined,
    }) as unknown as Socket<Produced, Args, Failures>
}
