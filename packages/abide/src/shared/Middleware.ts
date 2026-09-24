// ONE RUNG OF AN ONION, and the onion. The app lane's `middleware` (37.3) and a handler's rungs
// (16.12) are the same shape over a different `Ctx`, so they compose through the one function.

export type Middleware<Ctx, Result> = (
    next: (ctx?: Ctx) => Promise<Result>,
    ctx: Ctx,
) => Result | Promise<Result>

// 16.15 — COMPOSED ONCE, where the table is built, rather than folded per call. 16.16 — each link
// holds its rung and the link inside it, and nothing about the request it will be handed. 16.17 — a
// rung that never calls `next` answers in the handler's place. 16.22 — a throw is not caught here, so
// it leaves the whole onion rather than unwinding through the rungs outside it.
//
// `next()` with no argument hands the inner link the ctx this rung was given.
export function compose<Ctx, Result>(
    rungs: readonly Middleware<Ctx, Result>[],
    terminal: (ctx: Ctx) => Promise<Result>,
): (ctx: Ctx) => Promise<Result> {
    let link = terminal
    for (let at = rungs.length - 1; at >= 0; at -= 1)
        link = linkOf(rungs[at] as Middleware<Ctx, Result>, link)
    return link
}

function linkOf<Ctx, Result>(
    rung: Middleware<Ctx, Result>,
    inner: (ctx: Ctx) => Promise<Result>,
): (ctx: Ctx) => Promise<Result> {
    return async (ctx) => rung((given) => inner(given ?? ctx), ctx)
}
