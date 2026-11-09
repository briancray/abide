// ONE RUNG OF AN ONION, and the onion. The app lane's `middleware` (37.3) and a handler's rungs
// (16.11) are the same shape over a different `Ctx`, so they compose through the one function.

import type { Failed } from './Failed.ts'

/**
 * A rung written once for every lane whose context carries `Extra`: generic over the context it is
 * handed and over what `next` answers, so it passes `next()`'s answer on, refuses in its place, or
 * answers with an `Answer` of its own.
 *
 * `Refused` is what it may refuse with; a rung naming its refusals carries them onto the `Rpc` its
 * handler is declared with (16.86), where one left at `Failed<string, unknown>` carries none.
 *
 * `Result` IS BOUNDED BY EVERYTHING BUT `unknown`. A rung read outside a context — listed by a
 * helper, or beside the plain array arm of `RpcOptions['middleware']` — is read at its erased
 * signature, where `Result` is its bound, and an `unknown` there absorbs `Refused` in the union.
 */
export type Middleware<
    Answer = never,
    Extra extends object = object,
    Refused extends Failed<string, unknown> = Failed<string, unknown>,
> = <
    Given extends { request: Request } & Extra,
    Result extends {} | null | undefined,
>(
    next: (ctx?: Given) => Promise<Result>,
    ctx: Given,
) => Result | Answer | Refused | Promise<Result | Answer | Refused>

/** A rung as one lane composes it, over that lane's context and what its center answers. */
export type Rung<Ctx, Result> = (
    next: (ctx?: Ctx) => Promise<Result>,
    ctx: Ctx,
) => Result | Promise<Result>

/**
 * Composes rungs around a terminal handler into one function, outermost rung first.
 *
 * 16.14 — COMPOSED ONCE, where the table is built, rather than folded per call. 16.15 — each link
 * holds its rung and the link inside it, and nothing about the request it will be handed. 16.16 —
 * a rung that never calls `next` answers in the handler's place. 16.21 — a throw is not caught
 * here, so it leaves the whole onion rather than unwinding through the rungs outside it.
 *
 * `next()` with no argument hands the inner link the ctx this rung was given.
 */
export function compose<Ctx, Result>(
    rungs: readonly Rung<Ctx, Result>[],
    terminal: (ctx: Ctx) => Promise<Result>,
): (ctx: Ctx) => Promise<Result> {
    let link = terminal
    for (let at = rungs.length - 1; at >= 0; at -= 1)
        link = linkOf(rungs[at] as Rung<Ctx, Result>, link)
    return link
}

function linkOf<Ctx, Result>(
    rung: Rung<Ctx, Result>,
    inner: (ctx: Ctx) => Promise<Result>,
): (ctx: Ctx) => Promise<Result> {
    return async (ctx) => rung((given) => inner(given ?? ctx), ctx)
}
