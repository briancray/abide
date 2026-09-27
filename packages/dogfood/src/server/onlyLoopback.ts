// THE BENCH AND TESTS HANDLERS ANSWER A READER ON THIS MACHINE ONLY. They spawn the suites, so a
// docs deploy that answered them would run the repo's tests for anyone who asked.
//
// BY THE HOST THE REQUEST NAMED, which a caller writes — so this keeps a deployed docs app from
// answering by accident, and is not a boundary against someone set on reaching it.
//
// AND BY WHO ASKED. They are GETs, which the origin check on mutations lets through, so any page
// open in the reader's browser could start a run with an `<img src>` — the browser names that
// request `cross-site` or `same-site`, and a caller outside a browser sends no such header.

import { refuse } from 'abide'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export async function onlyLoopback<Ctx extends { request: Request }, Result>(
    next: (ctx?: Ctx) => Promise<Result>,
    ctx: Ctx,
) {
    const fetchSite = ctx.request.headers.get('sec-fetch-site')
    if (
        !LOOPBACK.has(new URL(ctx.request.url).hostname) ||
        (fetchSite !== null &&
            fetchSite !== 'same-origin' &&
            fetchSite !== 'none')
    )
        return refuse(
            403,
            'The bench and the tests run on the machine serving these docs, and only for a reader on it.',
        )
    return next(ctx)
}
