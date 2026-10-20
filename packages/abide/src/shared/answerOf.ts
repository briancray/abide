// 41.21 — A CALL THE PAGE ALREADY STARTED IS TAKEN, NOT MADE AGAIN, and what a call answered is read
// one way whoever made it: a handler's `wire`, and a handler abide mounts itself (`seededDocument`).
//
// ONE CLASSIFIER. The early-call script (41.20) records the `Response` and nothing it decides, so
// an answer the page started and one fetched here are read by `answerFrom` alike.

import { failedFrom, isProblem } from './Failed.ts'
import {
    carriesBytes,
    type Framed,
    framedChunks,
    framingOf,
} from './framing.ts'
import { principalRotated } from './principalRotated.ts'
import { refuse } from './refuse.ts'
import type { RpcRequest } from './rpcRequest.ts'
import { takeEarlyCall } from './takeEarlyCall.ts'
import { VERSION_HEADER } from './VERSION_HEADER.ts'
import { versionInEtag } from './versionInEtag.ts'

/** What a call answered, classified once. */
export type Answer = {
    status: number
    statusText: string
    /** A 2xx. */
    ok: boolean
    /** What precedes each chunk's JSON on its line (16.32), or `null` where the answer is not framed. */
    framing: Framed | null
    /**
     * Whether a subscriber may follow it (18.24): a 2xx that is not a binary, whose bytes the mux's
     * JSON frames cannot carry.
     */
    followable: boolean
    /** The version its `ETag` named (18.5). */
    version: number | undefined
    /** The `max-age` its `cache-control` named, in ms (18.14, 21.8). */
    life: number | undefined
    text: string | undefined
    /**
     * A binary answer's body read to the end (16.34), set in place of `text` — a body read as text
     * is not the bytes it carried.
     */
    bytes: Uint8Array | undefined
    /**
     * A streamed answer's body, left unread so its chunks are taken as they land (16.32): framed,
     * or a binary's where `framing` is `null`.
     */
    body: ReadableStream<Uint8Array> | null | undefined
}

/**
 * A call's answer: the early call's where the page started one, fetched where it did not.
 *
 * 41.27 — SETTLED AT ONCE ONLY WHERE THE SERVER PAINTED IT SETTLED. One it painted in flight is in
 * flight while the page adopts, however early its answer landed, so the arm adopted is the arm
 * painted and the answer then swaps it as any answer does.
 *
 * 16.32 — a `streams` caller is handed a framed answer's body unread; any other has it read to the
 * end.
 */
export function answerOf(
    request: RpcRequest,
    streams: boolean,
    signal: AbortSignal | undefined,
): Answer | Promise<Answer> {
    const early = takeEarlyCall(request.key)
    if (early === undefined) return fetched(request, streams, signal)
    if (early.painted === 1 && early.response !== undefined)
        return answerFrom(early.response, early.bytes, streams)
    // An early call whose request failed is made again.
    return early.promise.then(() =>
        early.response === undefined
            ? fetched(request, streams, signal)
            : answerFrom(early.response, early.bytes, streams),
    )
}

/** Fetches a call's answer. */
async function fetched(
    request: RpcRequest,
    streams: boolean,
    signal: AbortSignal | undefined,
): Promise<Answer> {
    let response: Response
    try {
        response = await fetch(
            request.url,
            signal === undefined ? request.init : { ...request.init, signal },
        )
    } catch (error) {
        // An abort is the load's own ending (16.49), which the value has already answered.
        if (signal?.aborted === true) throw error
        // 16.79 — NO ANSWER AT ALL, as a status the app can narrow on rather than the browser's
        // own `TypeError`, whose message differs in each.
        return unanswered()
    }
    // THE HANDLER SIGNED THIS CALLER IN OR OUT, and the cookie is already the browser's.
    principalRotated(response)
    return answerFrom(response, undefined, streams)
}

/** The answer a call that reached no server stands in for: an empty 503, which `answered` refuses. */
function unanswered(): Answer {
    return {
        status: 503,
        statusText: '',
        ok: false,
        framing: null,
        followable: false,
        version: undefined,
        life: undefined,
        text: '',
        bytes: undefined,
        body: undefined,
    }
}

/**
 * `response`, classified: a body `read` to its end already (an early call the server painted)
 * decoded as what it carried, and one unread read as bytes where it is a binary (16.34), as text
 * otherwise — or left unread for a `streams` caller where it is framed or a binary (16.32, 16.46).
 */
function answerFrom(
    response: Response,
    read: ArrayBuffer | undefined,
    streams: boolean,
): Answer | Promise<Answer> {
    const { status, statusText, headers } = response
    const type = headers.get('content-type')
    const ok = status >= 200 && status < 300
    const framing = framingOf(type)
    const binary = ok && carriesBytes(type)
    const seconds = /max-age=(\d+)/.exec(headers.get('cache-control') ?? '')
    const answer: Answer = {
        status,
        statusText,
        ok,
        framing,
        followable: ok && !binary,
        version: versionInEtag(headers.get(VERSION_HEADER)),
        life: seconds === null ? undefined : Number(seconds[1]) * 1000,
        text: undefined,
        bytes: undefined,
        body: undefined,
    }
    if (read !== undefined) {
        if (binary) answer.bytes = new Uint8Array(read)
        else answer.text = new TextDecoder().decode(read)
        return answer
    }
    if (streams && ok && (binary || framing !== null)) {
        answer.body = response.body
        return answer
    }
    return binary
        ? response.arrayBuffer().then((buffer) => {
              answer.bytes = new Uint8Array(buffer)
              return answer
          })
        : response.text().then((text) => {
              answer.text = text
              return answer
          })
}

/**
 * What a call's body hands back: the value, nothing (16.31), or the refusal it was answered with.
 *
 * The refusal (15.1) is rebuilt as the `Failed` the server returned. RETURNED, so the value refuses
 * (15.5) rather than failing the way a network error does.
 *
 * 16.32 — A FRAMED STREAM IS COLLECTED INTO THE CHUNKS IT CARRIED, which is the value a streaming
 * handler holds once its run has closed — for a copy the build did not mark as streaming, whose
 * value is one production. A marked one reads its body as it lands (`framedStream`).
 */
export function answered(answer: Answer): unknown {
    if (answer.status === 204) return undefined
    if (answer.ok) {
        // 16.34 — a binary decodes back to the bytes it was.
        if (answer.bytes !== undefined) return answer.bytes
        if (answer.framing !== null)
            return framedChunks(answer.text ?? '', answer.framing)
    }
    let body: unknown
    try {
        body = answer.text === '' ? undefined : JSON.parse(answer.text ?? '')
    } catch {
        body = undefined
    }
    if (answer.ok) return body
    if (isProblem(body)) return failedFrom(body)
    return refuse(answer.status, answer.statusText || undefined)
}
