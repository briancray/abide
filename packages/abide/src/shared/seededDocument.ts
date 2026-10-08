// 41.20, 41.21 — THE CALL A HANDLER'S `wire` MAKES, less the follow, for a handler abide mounts
// itself: the page's early-call script started it where a render made the call, and it is taken
// from there before it is fetched. Not followed over the mux, which carries app handlers'
// productions and has none of abide's own to send.

import { answered, answerOf } from './answerOf.ts'
import type { Failed } from './Failed.ts'
import { mounted } from './mount.ts'
import { rpcRequest } from './rpcRequest.ts'

/**
 * What `GET address` answers in a browser: the early call's answer where there is one.
 *
 * A refusal is read as `wire` reads one — the `Failed` the server answered with, returned.
 */
export async function seededDocument<Document>(
    address: string,
): Promise<Document | Failed<string, unknown>> {
    return answered(
        await answerOf(
            rpcRequest('GET', mounted(address), undefined),
            false,
            undefined,
        ),
    ) as Document | Failed<string, unknown>
}
