// 16.29 — A HANDLER, AS A BROWSER HOLDS IT. What a page imported as `getInvoice` is, in the bundle,
// `wire('GET', '/__abide/rpc/invoices/getInvoice')`: the same declaration the server made, over a
// body that fetches rather than one that reads the database. So it is the same `Rpc` — the call
// hands back a `Reactive`, the keyed face narrows by args, a mutation's `ttl` is 0 (16.7), and a
// refusal narrows through `isError` — because it is built by the one `declare` both seams share.
//
// 41.21 — A CALL THE PAGE ALREADY STARTED IS TAKEN, NOT MADE AGAIN. A server-rendered page's early-call
// script (41.20) sent this page's calls while the body was still arriving; the first reach of each
// takes its answer — at once where it has arrived and the server painted it settled, which lands the
// value in the same run as hydration's setup (41.25, 41.27) — and every reach after that fetches, a refresh
// being a new call.
//
// 18.17, 18.24 — EVERY `GET` LOADED IS FOLLOWED over the mux, naming the version its answer carried:
// a trigger on the server reaches the copy for these args, and a `global` value's changes arrive as
// values the copy takes (18.25).
//
// An entry of its own (`abide/wire`) rather than a name on the runtime barrel: only a generated
// wrapper imports it, and a page with no handler pays nothing for it.

import { answered, answerOf } from '#shared/answerOf.ts'
import type { CopyOptions } from '#shared/CopyOptions.ts'
import { isFailed } from '#shared/Failed.ts'
import { answerChunks } from '#shared/framing.ts'
import { LOAD_SIGNAL } from '#shared/LOAD_SIGNAL.ts'
import { reactive, structural } from '#shared/reactive/index.ts'
import {
    type Defaults,
    declareDefaults,
} from '#shared/reactive/parameterDefaults.ts'
import { declare, type Method } from '#shared/rpc.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import type { Answer } from '#shared/takeEarlyCall.ts'
import { followRpc } from './socketWire.ts'

/** The browser's `Rpc` for a handler: the server's declaration over a body that fetches. */
export function wire(
    method: Method,
    address: string,
    // 18.19 — what the build read off the handler's declaration.
    options?: CopyOptions,
    // 11.29 — and the defaults its parameter writes, which the copy keys by as the server does.
    defaults?: Defaults,
): unknown {
    // ONE PARAMETER, so the value is keyed by args whatever the handler declared (16.6's arity rule):
    // an unkeyed handler is reached with no args, which is one key.
    const body = (args: Record<string, unknown> | undefined) => {
        // 16.53 — the load's own signal, set by the call starting it and read before anything awaits.
        const signal = LOAD_SIGNAL.current
        const settle = (answer: Answer): unknown => {
            if (method === 'GET') follow(args, answer)
            return answered(answer)
        }
        const answer = answerOf(
            rpcRequest(method, address, args),
            false,
            signal,
        )
        return answer instanceof Promise ? answer.then(settle) : settle(answer)
    }
    // 16.33 — A STREAMING HANDLER'S COPY IS A STREAM OF ITS OWN, whose chunks land as the answer's
    // lines arrive: collected into one value, a page reading it showed nothing until the handler's
    // last chunk. A refusal is thrown, which is how a stream refuses (9.20).
    const streamed = async function* (
        args: Record<string, unknown> | undefined,
    ): AsyncGenerator<unknown> {
        // 16.53 — read on the first line: the core's pump takes the first step inside the reach, so
        // this runs while the call that started the load still has its signal set.
        const signal = LOAD_SIGNAL.current
        const answer = await answerOf(
            rpcRequest(method, address, args),
            true,
            signal,
        )
        if (method === 'GET') follow(args, answer)
        if (answer.body !== undefined && answer.body !== null) {
            yield* answerChunks(answer.body, answer.type)
            return
        }
        const value = answered(answer)
        if (isFailed(value)) throw value
        if (Array.isArray(value)) yield* value
    }
    // 18.17, 18.24 — the version the answer named, and 18.29 — the `max-age` left of its life, where
    // it named one: `max-age=0` is a life the server rounded down to nothing, and stale now.
    const follow = (args: unknown, answer: Answer): void => {
        const seconds = /max-age=(\d+)/.exec(answer.life ?? '')?.[1]
        followRpc(
            address,
            args,
            answer.version === null || answer.version === undefined
                ? undefined
                : Number(answer.version),
            seconds === undefined ? undefined : Number(seconds) * 1000,
            () => (value as (args: unknown) => unknown)(args),
        )
    }
    // A KEYED VALUE OF ITS OWN where the handler's declares what its copy behaves by, so every entry —
    // the copy a page walks — carries it: its key (32.32), its tags (11.44), its retention (6.1) and
    // its comparator (5.3). A `GET` alone: a mutation's value is written and read once.
    const produce = options?.stream === true ? streamed : body
    if (defaults !== undefined) declareDefaults(produce, defaults)
    // A `GET`'S ENTRY IS LOOKED UP BY ITS FOLLOW through the value, not the `Rpc`: a call made with no
    // signal pins the load it reaches (16.52), and a frame from the server would pin one a page was
    // still free to abort. A mutation's is `declare`'s to make, which is where its `ttl` of 0 is.
    const value =
        method === 'GET'
            ? reactive(
                  produce,
                  options === undefined ? undefined : copyOptions(options),
              )
            : produce
    const rpc = declare(method)(value)
    // 16.10 — the address `rpc.url` and `rpc.raw` build on.
    rpc.address = address
    return rpc
}

/**
 * The build's copy options as a value takes them, `structural` resolved to its function.
 *
 * Checked against the value's own types where they were written, on the server; here they are data.
 */
function copyOptions(options: CopyOptions): never {
    // `stream` is the wire's to read, and not an option a value takes.
    const { identity, stream: _, ...rest } = options
    return (
        identity === 'structural' ? { ...rest, identity: structural } : rest
    ) as never
}

// 18.2 — a socket's wrapper, from the same entry, since only a generated wrapper imports either.
export { socketWire } from './socketWire.ts'
