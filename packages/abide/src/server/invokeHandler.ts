// 16.2 — ONE HANDLER, CALLED FOR ONE CALLER, whichever lane the call came over. What a call over
// http and a subscription over the mux both owe the handler is decided here — the origin gate
// (16.13, 18.2), the args contract (19.7, 19.9), the rungs a follow is held to (18.8, 18.26), the
// seed a render left (41.13) and the `global` entry the answer came from (21.15) — and what a lane
// adds is the decoding of what it was sent and the encoding of what it answers.
//
// THE IN-PROCESS CALL is `#shared/rpc.ts`'s, which a browser bundle reaches too, so it cannot be
// this module's; a call over a lane is that call, made in the request's scope.

import { type Failed, isFailed } from '#shared/Failed.ts'
import { GLOBAL_GETS } from '#shared/GLOBAL_GETS.ts'
import { compose } from '#shared/Middleware.ts'
import { heldGenerationOf } from '#shared/reactive/index.ts'
import { argsInURL, rpcRequest } from '#shared/rpcRequest.ts'

import { argsFor } from './argsContract.ts'
import { callerOf } from './callerOf.ts'
import { closedTo, crossingRefusal } from './crossingOrigin.ts'
import type { FollowedHandler, Mounted } from './mountHandlers.ts'
import { currentRequestScope, rungsTook, timed } from './requestScope.ts'
import { type Outcome, outcomeOf, takeSeed } from './seedBuffer.ts'

/**
 * What the origin gate makes of a call from `crossing`: the refusal it is answered with, or the
 * origin its answer admits — `null` for the app's own, and for a read another origin may make but
 * not read (21.19).
 *
 * 16.13 — A MUTATION FROM ANOTHER ORIGIN IS REFUSED, and 18.2 — a subscription, unless the handler
 * declared it may come. 16.24, 36.2 — the same gate and the same own origin for every lane.
 */
export function originGate(
    handler: Mounted['handler'],
    crossing: string | null,
    following: boolean,
): Failed<'HttpError', undefined> | string | null {
    if (!closedTo(handler.crossOrigin, crossing)) return crossing
    if (following) return crossingRefusal(crossing, 'subscription')
    return argsInURL(handler.method)
        ? null
        : crossingRefusal(crossing, handler.method)
}

/** Which run answered a call, as 21.15's `server-timing` names it. */
type Run = 'Seeded' | 'Cached' | 'Started' | 'Direct'

/**
 * A handler's call, made: how it ended, the args it was held to, and the `global` entry it was
 * answered from.
 */
export class Invocation {
    readonly outcome: Outcome
    readonly args: unknown
    /** The entry key of a `global` value, or `undefined` for one built per request. */
    readonly key: string | undefined
    /** The `global` entry as the run left it, which the answer reads too. */
    readonly entry: unknown
    readonly run: Run
    readonly started: number

    constructor(
        outcome: Outcome,
        args: unknown,
        key: string | undefined,
        entry: unknown,
        run: Run,
        started: number,
    ) {
        this.outcome = outcome
        this.args = args
        this.key = key
        this.entry = entry
        this.run = run
        this.started = started
    }

    /**
     * 21.15 — HOW LONG THE HANDLER TOOK, AND WHICH RUN THIS IS, for the network panel: the row
     * already names the handler, so the metric names the run. Read once the answer's head is built,
     * so a stream's time is to its first chunk.
     */
    timed(): void {
        const timing = currentRequestScope()?.timing
        const took = this.outcome.duration ?? performance.now() - this.started
        // 21.20 — what the rungs took is theirs, and the handler's own body is what `Direct` reports.
        const handled = this.run === 'Direct' ? timing?.handled : undefined
        if (handled !== undefined) rungsTook(took - handled)
        timed(timing, this.run, handled ?? took)
    }
}

/**
 * Calls `mounted`'s handler with what a lane decoded: `given` its args, `text` the query a URL or
 * a form carried them as (19.7), `params` what its route matched.
 *
 * Answers the refusal its args were refused with, or the call made. `seeds` is whether a seed a
 * page's render left may answer it (41.7) — 16.51, a `HEAD` leaves it for the `GET` it stands in
 * front of.
 */
export async function invokeHandler(
    mounted: Mounted,
    given: unknown,
    text: string | undefined,
    params: Record<string, string | string[]>,
    seeds: boolean,
): Promise<Invocation | Failed<string, unknown>> {
    const handler = mounted.handler
    let args: unknown
    try {
        args = argsFor(handler, given, text, params)
    } catch (refused) {
        if (isFailed(refused)) return refused
        throw refused
    }
    // 41.7 — the call a hydrating page makes for what its render already reached is answered from
    // that, and the handler is not run again (41.13).
    const caller = seeds ? callerOf() : undefined
    const seeded =
        caller === undefined ? undefined : takeSeed(caller, handler, args)
    // The entry key of a `global` value, taken once for every read of it below.
    const global = GLOBAL_GETS.get(handler)
    const key = global?.key(args)
    // 21.15 — A `global` PRODUCTION ALREADY HELD, and not loading, answers without a run: a run
    // this call started moves the generation, and one it joined was loading when it came.
    const held =
        seeded === undefined && key !== undefined ? global?.at(key) : undefined
    const heldAt = held === undefined ? undefined : heldGenerationOf(held)
    const timing = currentRequestScope()?.timing
    if (timing !== undefined) timing.answering = handler
    const started = performance.now()
    const outcome =
        seeded === undefined ? await outcomeOf(handler(args)) : await seeded
    const entry = key === undefined ? undefined : global?.at(key)
    const run: Run =
        seeded !== undefined
            ? 'Seeded'
            : heldAt !== undefined &&
                entry === held &&
                heldGenerationOf(held) === heldAt
              ? 'Cached'
              : outcome.duration === undefined
                ? 'Started'
                : 'Direct'
    return new Invocation(outcome, args, key, entry, run, started)
}

/**
 * The args a subscription to `mounted` follows, held to its contract as a `GET` over http is
 * (18.3) — or a throw of the refusal, the origin gate's included (18.2).
 */
export function followedArgs(
    mounted: FollowedHandler,
    given: unknown,
    crossing: string | null,
): unknown {
    const gate = originGate(mounted.handler, crossing, true)
    if (isFailed(gate)) throw gate
    return argsFor(mounted.handler, given, undefined)
}

/**
 * Whether a subscription to `mounted` with `args` is fed its productions, asked over `upgrade`, the
 * request the connection opened with — settled where nothing guards it.
 *
 * 18.8 — A GUARDED `GET`'s RUNGS RUN ONCE, as the subscription opens: one they admit is fed the
 * value, and one they refuse is sent its triggers alone. 18.26 — AND THE MIDDLEWARE ITS FILE'S
 * ROUTE FILED, over the request a `GET` of it would be: one a rung answers in the handler's place is
 * not fed, as an http call it answered would never reach the handler.
 */
export function admitsFollower(
    mounted: FollowedHandler,
    args: unknown,
    upgrade: Request,
): boolean | Promise<boolean> {
    // No route rungs, no turn: a guarded `GET`'s rungs start in this frame's own run.
    if (mounted.rungs.length === 0)
        return mounted.handler.guarded ? handlerAdmits(mounted, args) : true
    return throughRoute(mounted, args, upgrade)
}

async function throughRoute(
    mounted: FollowedHandler,
    args: unknown,
    upgrade: Request,
): Promise<boolean> {
    if (!(await routeAdmits(mounted, args, upgrade))) return false
    return !mounted.handler.guarded || handlerAdmits(mounted, args)
}

/** Whether the handler's own rungs let a call with `args` through. 18.8. */
function handlerAdmits(
    mounted: FollowedHandler,
    args: unknown,
): Promise<boolean> {
    return Promise.resolve(
        mounted.handler(args as never) as PromiseLike<unknown>,
    ).then(
        () => true,
        () => false,
    )
}

/**
 * Whether the rungs over `mounted`'s route let a `GET` of it with `args` through, asked over the
 * upgrade's own request at the handler's address. 18.26.
 */
async function routeAdmits(
    mounted: FollowedHandler,
    args: unknown,
    upgrade: Request,
): Promise<boolean> {
    const asked = rpcRequest(
        'GET',
        mounted.address,
        args as Record<string, unknown> | undefined,
    )
    const request = new Request(new URL(asked.url, upgrade.url), {
        headers: upgrade.headers,
        signal: upgrade.signal,
    })
    // REACHED BY A FLAG, not by the answer's identity: a rung that wraps or re-heads what `next`
    // answered still let the call through, and a shared answer would carry every rung's headers.
    let reached = false
    try {
        const answered = await compose(mounted.rungs, async () => {
            reached = true
            return new Response(null, { status: 204 })
        })({ request })
        return reached && answered.ok
    } catch {
        return false
    }
}
