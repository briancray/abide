// 41.21 — A CALL THE PAGE ALREADY STARTED IS TAKEN, NOT MADE AGAIN, and what a call answered is read
// one way whoever made it: a handler's `wire`, and a handler abide mounts itself (`seededDocument`).

import { failed, isFailed } from './Failed.ts'
import { carriesBytes, framedChunks, framingPrefix } from './framing.ts'
import { PRINCIPAL_HEADER } from './PRINCIPAL_HEADER.ts'
import { PRINCIPAL_ROTATED } from './PRINCIPAL_ROTATED.ts'
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
    if (readAsText(early) && early.painted === 1) return early
    return early.promise.then((): Answer | Promise<Answer> => {
        if (readAsText(early)) return early
        // The early call failed as a request — or read a binary as text, which lost its bytes — so
        // this one is made again.
        if (early.body === undefined || early.body === null)
            return fetched(request, streams, signal)
        if (streams) return early
        const read = new Response(early.body)
        return carriesBytes(early.type) && succeeded(early.status)
            ? read
                  .bytes()
                  .then((bytes) => ({ ...early, bytes, body: undefined }))
            : read.text().then((text) => ({ ...early, text, body: undefined }))
    })
}

/** Whether an early call's answer arrived as text that is what it carried — no binary read as one. */
function readAsText(early: Answer): boolean {
    return (
        early.text !== undefined &&
        !(carriesBytes(early.type) && succeeded(early.status))
    )
}

function succeeded(status: number | undefined): boolean {
    return status !== undefined && status >= 200 && status < 300
}

/**
 * Fetches a call's answer; a framed answer to a streaming copy keeps its body unread (16.33).
 *
 * Anything else is read to its end: as bytes where it is a binary (16.35), as text otherwise.
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
    // THE HANDLER SIGNED THIS CALLER IN OR OUT, and the cookie is already the browser's.
    if (answer.headers.has(PRINCIPAL_HEADER)) PRINCIPAL_ROTATED.current?.()
    const type = answer.headers.get('content-type')
    const binary = answer.ok && carriesBytes(type)
    // A streaming copy reads bytes as they land too (16.47), as it does a framed answer's lines.
    const unread =
        streams && answer.ok && (binary || framingPrefix(type) !== null)
    return {
        status: answer.status,
        statusText: answer.statusText,
        type,
        version: answer.headers.get(VERSION_HEADER),
        life: answer.headers.get('cache-control'),
        text: unread || binary ? undefined : await answer.text(),
        bytes: !unread && binary ? await answer.bytes() : undefined,
        body: unread ? answer.body : undefined,
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
    const ok = succeeded(status)
    if (ok) {
        // 16.35 — a binary decodes back to the bytes it was.
        if (answer.bytes !== undefined) return answer.bytes
        const prefix = framingPrefix(answer.type)
        if (prefix !== null) return framedChunks(answer.text ?? '', prefix)
    }
    let body: unknown
    try {
        body = answer.text === '' ? undefined : JSON.parse(answer.text ?? '')
    } catch {
        body = undefined
    }
    if (ok) return body
    if (isFailed(body))
        return failed(body.name, body.status, body.message, body.data)
    return refuse(status, answer.statusText || undefined)
}
