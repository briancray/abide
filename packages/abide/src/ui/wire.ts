// 16.28 — A HANDLER, AS A BROWSER HOLDS IT. What a page imported as `getInvoice` is, in the bundle,
// `wire('GET', '/invoices/getInvoice')`: the same declaration the server made, over a
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
// 18.3, 18.9 — EVERY `GET` LOADED IS FOLLOWED over the mux, naming the version its answer carried:
// a trigger on the server reaches the copy for these args, and a `global` value's changes arrive as
// values the copy takes (18.10).
//
// An entry of its own (`@abide/abide/wire`) rather than a name on the runtime barrel: only a generated
// wrapper imports it, and a page with no handler pays nothing for it.

import {
    type Answer,
    answered,
    answerOf,
    noAnswer,
    unanswered,
} from '#shared/answerOf.ts'
import type { CopyOptions } from '#shared/CopyOptions.ts'
import { isFailed } from '#shared/Failed.ts'
import { answerChunks } from '#shared/framing.ts'
import { HandlerRoute } from '#shared/HandlerRoute.ts'
import type { JsonValue } from '#shared/JsonValue.ts'
import { LOAD_OFFLINE } from '#shared/LOAD_OFFLINE.ts'
import { LOAD_SIGNAL } from '#shared/LOAD_SIGNAL.ts'
import { reactive, standIn, structural } from '#shared/reactive/index.ts'
import {
    declareDefaults,
    type Defaults,
} from '#shared/reactive/parameterDefaults.ts'
import { declare, type Method } from '#shared/rpc.ts'
import { type RpcRequest, rpcRequest } from '#shared/rpcRequest.ts'

import { enqueue, undelivered } from './outboxQueue.ts'
import { followRpc } from './socketWire.ts'

/** The browser's `Rpc` for a handler: the server's declaration over a body that fetches. */
export function wire(
    method: Method,
    address: string,
    // 18.4 — what the build read off the handler's declaration.
    options?: CopyOptions,
    // 11.29 — and the defaults its parameter writes, which the copy keys by as the server does.
    defaults?: Defaults,
): unknown {
    // 16.9 — the handler's route, compiled once for every call through the copy.
    const route = new HandlerRoute(address)
    // 16.80 — the requests this page has had an answer to, whose next load asks past every cache.
    // A first load is the worker's to answer from its copy, where one answers this page: anywhere
    // else the cache below is the browser's, which would hand back a week-stale answer as the server's.
    const answeredOnce = new Set<string>()
    const requestOf = (args: Record<string, unknown> | undefined) => {
        const request = rpcRequest(method, route, args)
        if (
            !answeredOnce.has(request.key) &&
            navigator.serviceWorker?.controller
        )
            request.init.cache = 'force-cache'
        return request
    }
    // 16.81 — WHAT STANDS IN FOR A `GET`'s ANSWER, per args, as the last call reaching them gave it:
    // a reload no call starts — a refresh, the network coming back — has no `offline` of its own.
    const standIns = new Map<string, (args: unknown) => unknown>()
    // ONE PARAMETER, so the value is keyed by args whatever the handler declared (16.6's arity rule):
    // an unkeyed handler is reached with no args, which is one key.
    const body = (args: Record<string, unknown> | undefined) => {
        // 16.49, 16.81 — the load's own signal and stand-in, set by the call starting it and read
        // before anything awaits.
        const signal = LOAD_SIGNAL.current
        const request = requestOf(args)
        let offline = LOAD_OFFLINE.current
        // A reload no call started — a refresh, or the one `whenOnline` asks — that gets no answer
        // waits before asking again, where asking at once would get none on every tick.
        const retryIn = offline === undefined ? UNANSWERED_RETRY_MS : 0
        if (method === 'GET') {
            if (offline === undefined) offline = standIns.get(request.key)
            else standIns.set(request.key, offline)
        }
        // A STAND-IN IS FOR A COPY HOLDING NOTHING: a reload that gets no answer over one this page
        // already holds keeps serving it (7.4, 7.19) rather than trading it for a default.
        const first = !answeredOnce.has(request.key)
        // 16.82, 46.10 — a mutation that may be queued carries the key it is sent under every time.
        const queued =
            offline !== undefined && method !== 'GET'
                ? queuedCall(request, address, args)
                : undefined
        let standing: { value: unknown } | undefined
        if (queued !== undefined)
            LOAD_OFFLINE.standing = standing = { value: undefined }
        const stoodIn = (failed: Answer): unknown => {
            const value = (offline as (args: unknown) => unknown)(args)
            if (queued === undefined) {
                whenOnline(args, retryIn)
                return standIn(value)
            }
            return enqueue(queued, standing as { value: unknown }, value).then(
                (kept) => (kept ? standIn(value) : answered(failed)),
            )
        }
        // 16.83 — BEHIND CALLS NOT YET DELIVERED A CALL WAITS ITS TURN, rather than overtaking them.
        if (queued !== undefined && undelivered() !== 0)
            return Promise.resolve(stoodIn(noAnswer()))
        const settle = (answer: Answer): unknown => {
            if (answer.ok) answeredOnce.add(request.key)
            if (
                offline !== undefined &&
                unanswered(answer) &&
                (first || queued !== undefined)
            )
                return stoodIn(answer)
            follow(args, answer)
            // 16.85 — A COPY THE WORKER KEPT IS NOT THE SERVER'S ANSWER: held as written here, and
            // asked of the network once there is one.
            if (answer.kept) {
                whenOnline(args, 0)
                return standIn(answered(answer))
            }
            return answered(answer)
        }
        const answer = answerOf(request, false, signal)
        return answer instanceof Promise ? answer.then(settle) : settle(answer)
    }
    // 16.81, 16.85 — A COPY HOLDING A STAND-IN ASKS THE NETWORK AGAIN once there is one: now, past the
    // landing (or `delay` past it), where the browser says it is online, and when it says so otherwise.
    const whenOnline = (args: unknown, delay: number): void => {
        if (method !== 'GET') return
        const again = (): void =>
            (value as (args: unknown) => { refresh(): void })(args).refresh()
        if (navigator.onLine) setTimeout(again, delay)
        else addEventListener('online', again, { once: true })
    }
    // 16.32 — A STREAMING HANDLER'S COPY IS A STREAM OF ITS OWN, whose chunks land as the answer's
    // lines arrive: collected into one value, a page reading it showed nothing until the handler's
    // last chunk. A refusal is thrown, which is how a stream refuses (9.6).
    const streamed = async function* (
        args: Record<string, unknown> | undefined,
    ): AsyncGenerator<unknown> {
        // 16.49 — read on the first line: the core's pump takes the first step inside the reach, so
        // this runs while the call that started the load still has its signal set.
        const signal = LOAD_SIGNAL.current
        const request = requestOf(args)
        const answer = await answerOf(request, true, signal)
        if (answer.ok) answeredOnce.add(request.key)
        follow(args, answer)
        if (answer.body !== undefined && answer.body !== null) {
            yield* answerChunks(answer.body, answer.framing)
            return
        }
        const value = answered(answer)
        if (isFailed(value)) throw value
        if (Array.isArray(value)) yield* value
    }
    // 18.3, 18.9 — the version the answer named, and 18.14 — the `max-age` left of its life, where
    // it named one: `max-age=0` is a life the server rounded down to nothing, and stale now.
    //
    // 18.24 — A REFUSAL IS NOT FOLLOWED: the mux answers in the scope its upgrade carried (18.16),
    // so a caller signed out since would be fed what this answer just refused it. Nor a binary,
    // which the mux's JSON frames cannot carry.
    const follow = (args: unknown, answer: Answer): void => {
        if (method === 'GET' && answer.followable)
            followRpc(address, args, answer.version, answer.life, () =>
                (value as (args: unknown) => unknown)(args),
            )
    }
    // A KEYED VALUE OF ITS OWN where the handler's declares what its copy behaves by, so every entry —
    // the copy a page walks — carries it: its key (32.32), its tags (11.43) and its comparator (5.3). A `GET` alone: a mutation's value is written and read once.
    const produce = options?.stream === true ? streamed : body
    if (defaults !== undefined) declareDefaults(produce, defaults)
    // A `GET`'S ENTRY IS LOOKED UP BY ITS FOLLOW through the value, not the `Rpc`: a call made with no
    // signal pins the load it reaches (16.48), and a frame from the server would pin one a page was
    // still free to abort. A mutation's is `declare`'s to make, which is where its `ttl` of 0 is.
    const value =
        method === 'GET'
            ? reactive(
                  produce,
                  options === undefined ? undefined : copyOptions(options),
              )
            : produce
    // Typed as the body either way: `declare` reads which arm off the brand (16.5), and its types
    // keep a built value off the arms that build one.
    const rpc = declare(method)(value as typeof produce)
    // 16.9 — the address `rpc.url` and `rpc.raw` build on.
    rpc.address = address
    return rpc
}

/** How long a reload that got no answer waits to ask again where the browser says it is online. */
const UNANSWERED_RETRY_MS = 5_000

/** A mutation's call as the outbox keeps it, under the key it is sent with every time (46.10). */
function queuedCall(
    request: RpcRequest,
    address: string,
    args: Record<string, unknown> | undefined,
): Parameters<typeof enqueue>[0] {
    const id = crypto.randomUUID()
    const headers = new Headers(request.init.headers)
    headers.set('idempotency-key', id)
    request.init.headers = headers
    return {
        id,
        method: request.method,
        address,
        url: request.url,
        args: args as Record<string, JsonValue> | undefined,
    }
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
