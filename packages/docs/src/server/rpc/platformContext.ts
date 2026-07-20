// #demo platformContext
import { context } from 'abide/server/context'
import { GET } from 'abide/server/GET'

// `context()` is a per-request, free-form carrier bag. A per-RPC middleware writes into it; the handler
// beneath it in the onion reads it back — the hand-off from a middleware layer to the handler.
const stamp = (next: () => Response | Promise<Response>) => {
    context().stampedBy = 'platformContext.middleware'
    context().stampedAt = 2026
    return next()
}

export default GET(
    () => {
        const bag = context()
        return {
            stampedBy: typeof bag.stampedBy === 'string' ? bag.stampedBy : null,
            stampedAt: typeof bag.stampedAt === 'number' ? bag.stampedAt : null,
        }
    },
    { middleware: [stamp] },
)
// #enddemo
