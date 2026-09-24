// SECTION 18 — A VALUE CARRIED OVER A WEB SOCKET. `socket` declares one over a `reactive` or a `Keyed`
// (18.1), and the call hands back that value's own `Reactive` for the args, as `GET` does (16.3). On a
// server the call reaches the value itself; a browser is handed `socketWire` in its place, whose call
// is a subscriber's copy fed over the one mux every socket shares (18.2).
//
// PROCESS-WIDE (9.16): a value built with `global` (11.34), refused otherwise (18.18), so a publish
// inside a request reaches the one every subscriber is fed from rather than a copy filed under it.

import { compose, type Middleware } from './Middleware.ts'
import { isKeyed, type Keyed, type Reactive } from './reactive/index.ts'
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
