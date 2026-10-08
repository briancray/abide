// 41.21 — A CALL THE PAGE ALREADY STARTED IS TAKEN, NOT MADE AGAIN, and what a call answered is read
// one way whoever made it: a handler's `wire`, and a handler abide mounts itself (`seededDocument`).

import { failed, isFailed } from './Failed.ts'
import { framedChunks, framingPrefix } from './framing.ts'
import { refuse } from './refuse.ts'
import type { RpcRequest } from './rpcRequest.ts'
import { type Answer, takeEarlyCall } from './takeEarlyCall.ts'
import { VERSION_HEADER } from './VERSION_HEADER.ts'

/**
 * A call's answer: the early call's where the page started one, fetched where it did not.
 *
 * 41.27 — SETTLED AT ONCE ONLY WHERE THE SERVER PAINTED IT SETTLED. One it painted in flight is in
 * flight while the page adopts, however early its answer landed, so the arm adopted is the arm
 * painted and the answer then swaps it as any answer does.
 *
 * 16.33 — a `streams` caller is handed a framed answer's body unread; any other has it read to the
 * end.
 */
export function answerOf(
    request: RpcRequest,
    streams: boolean,
    signal: AbortSignal | undefined,
): Answer | Promise<Answer> {
    const early = takeEarlyCall(request.key)
    if (early === undefined) return fetched(request, streams, signal)
    if (early.text !== undefined && early.painted === 1) return early
    return early.promise.then((): Answer | Promise<Answer> => {
        if (early.text !== undefined) return early
        // The early call failed as a request, so this one is made again.
        if (early.body === undefined || early.body === null)
            return fetched(request, streams, signal)
        if (streams) return early
        return new Response(early.body)
            .text()
            .then((text) => ({ ...early, text, body: undefined }))
    })
}

/**
 * Fetches a call's answer; a framed answer to a streaming copy keeps its body unread (16.33).
 *
 * Anything else is read as text.
 */
async function fetched(
    request: RpcRequest,
    streams: boolean,
    signal: AbortSignal | undefined,
): Promise<Answer> {
    const answer = await fetch(
        request.url,
        signal === undefined ? request.init : { ...request.init, signal },
    )
    const type = answer.headers.get('content-type')
    const framed = streams && answer.ok && framingPrefix(type) !== null
    return {
        status: answer.status,
        statusText: answer.statusText,
        type,
        version: answer.headers.get(VERSION_HEADER),
        life: answer.headers.get('cache-control'),
        text: framed ? undefined : await answer.text(),
        body: framed ? answer.body : undefined,
    }
}

/**
 * What a call's body hands back: the value, nothing (16.32), or the refusal it was answered with.
 *
 * The refusal (15.1) is rebuilt as the `Failed` the server returned. RETURNED, so the value refuses
 * (15.5) rather than failing the way a network error does.
 *
 * 16.33 — A FRAMED STREAM IS COLLECTED INTO THE CHUNKS IT CARRIED, which is the value a streaming
 * handler holds once its run has closed — for a copy the build did not mark as streaming, whose
 * value is one production. A marked one reads its body as it lands (`framedStream`).
 */
export function answered(answer: Answer): unknown {
    const status = answer.status ?? 0
    if (status === 204) return undefined
    const succeeded = status >= 200 && status < 300
    if (succeeded) {
        const prefix = framingPrefix(answer.type)
        if (prefix !== null) return framedChunks(answer.text ?? '', prefix)
    }
    let body: unknown
    try {
        body = answer.text === '' ? undefined : JSON.parse(answer.text ?? '')
    } catch {
        body = undefined
    }
    if (succeeded) return body
    if (isFailed(body))
        return failed(body.name, body.status, body.message, body.data)
    return refuse(status, answer.statusText || undefined)
}
