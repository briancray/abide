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
 *
 * 41.27 — SETTLED AT ONCE where the server painted the call settled, as `wire`'s body is, so a
 * value built on it is ready when the page adopts rather than on its loading arm.
 */
export function seededDocument<Document>(
    address: string,
):
    | Document
    | Failed<string, unknown>
    | Promise<Document | Failed<string, unknown>> {
    const answer = answerOf(
        rpcRequest('GET', mounted(address), undefined),
        false,
        undefined,
    )
    return (
        answer instanceof Promise ? answer.then(answered) : answered(answer)
    ) as
        | Document
        | Failed<string, unknown>
        | Promise<Document | Failed<string, unknown>>
}
