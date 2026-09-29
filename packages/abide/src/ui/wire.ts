// 16.29 — A HANDLER, AS A BROWSER HOLDS IT. What a page imported as `getInvoice` is, in the bundle,
// `wire('GET', '/__abide/rpc/invoices/getInvoice')`: the same declaration the server made, over a
// body that fetches rather than one that reads the database. So it is the same `Rpc` — the call
// hands back a `Reactive`, the keyed face narrows by args, a mutation's `ttl` is 0 (16.7), and a
// refusal narrows through `isError` — because it is built by the one `declare` both seams share.
//
// 41.21 — A CALL THE PAGE ALREADY STARTED IS TAKEN, NOT MADE AGAIN. A server-rendered page's early-call
// script (41.20) sent this page's calls while the body was still arriving; the first reach of each
// takes its answer — at once where it has arrived, which lands the value in the same run as
// hydration's setup — and every reach after that fetches, a refresh being a new call.
//
// 18.17, 18.24 — EVERY `GET` LOADED IS FOLLOWED over the mux, naming the version its answer carried:
// a trigger on the server reaches the copy for these args, and a `global` value's changes arrive as
// values the copy takes (18.25).
//
// An entry of its own (`abide/wire`) rather than a name on the runtime barrel: only a generated
// wrapper imports it, and a page with no handler pays nothing for it.

import type { CopyOptions } from '#shared/CopyOptions.ts'
import { EARLY_CALLS } from '#shared/EARLY_CALLS.ts'
import { LOAD_SIGNAL } from '#shared/LOAD_SIGNAL.ts'
import { failed, isFailed } from '#shared/Failed.ts'
import { reactive, structural } from '#shared/reactive/index.ts'
import { refuse } from '#shared/refuse.ts'
import { declare, type Method } from '#shared/rpc.ts'
import { type RpcRequest, rpcRequest } from '#shared/rpcRequest.ts'
import { VERSION_HEADER } from '#shared/VERSION_HEADER.ts'
import { followRpc } from './socketWire.ts'

/**
 * What a call answered: the status and the text — which stays unset where the request itself did
 * not complete.
 */
type Answer = {
    status: number | undefined
    statusText: string | undefined
    type: string | null | undefined
    /**
     * The answer's version, or `null` where it named none (18.20).
     *
     * A `null` is a value built per request.
     */
    version: string | null | undefined
    /** The answer's `cache-control`, whose `max-age` is how long the copy may serve it (21.8). */
    life: string | null | undefined
    text: string | undefined
    /**
     * A streamed answer's body, left unread so its chunks are taken as they land (16.33).
     *
     * Set in place of `text` for a handler the build marked as streaming, and by the early-call
     * script for any framed answer.
     */
    body: ReadableStream<Uint8Array> | null | undefined
}

/**
 * What the early-call script leaves per call: the request in flight, and once it has answered, what
 * it answered.
 */
type Early = Answer & { promise: Promise<void> }

/** The browser's `Rpc` for a handler: the server's declaration over a body that fetches. */
export function wire(
    method: Method,
    address: string,
    // 18.19 — what the build read off the handler's declaration.
    options?: CopyOptions,
): unknown {
    // ONE PARAMETER, so the value is keyed by args whatever the handler declared (16.6's arity rule):
    // an unkeyed handler is reached with no args, which is one key.
    const body = (args: Record<string, unknown> | undefined) => {
        // 16.54 — the load's own signal, set by the call starting it and read before anything awaits.
        const signal = LOAD_SIGNAL.current
        const request = rpcRequest(method, address, args)
        const settle = (answer: Answer): unknown => {
            if (method === 'GET') {
                const copy = (): unknown =>
                    (value as (args: unknown) => unknown)(args)
                followRpc(address, args, answer.version, answer.life, copy)
            }
            return answered(answer)
        }
        const started = (
            globalThis as unknown as Record<
                string,
                Record<string, Early | undefined> | undefined
            >
        )[EARLY_CALLS]
        const early = started?.[request.key]
        if (early === undefined)
            return fetched(request, false, signal).then(settle)
        ;(started as Record<string, Early | undefined>)[request.key] = undefined
        if (early.text !== undefined) return settle(early)
        return early.promise.then(() =>
            answerWithText(early, request, signal).then(settle),
        )
    }
    // 16.33 — A STREAMING HANDLER'S COPY IS A STREAM OF ITS OWN, whose chunks land as the answer's
    // lines arrive: collected into one value, a page reading it showed nothing until the handler's
    // last chunk. A refusal is thrown, which is how a stream refuses (9.20).
    const streamed = async function* (
        args: Record<string, unknown> | undefined,
    ): AsyncGenerator<unknown> {
        // 16.54 — read on the first line: the core's pump takes the first step inside the reach, so
        // this runs while the call that started the load still has its signal set.
        const signal = LOAD_SIGNAL.current
        const request = rpcRequest(method, address, args)
        const started = (
            globalThis as unknown as Record<
                string,
                Record<string, Early | undefined> | undefined
            >
        )[EARLY_CALLS]
        const early = started?.[request.key]
        let answer: Answer
        if (early === undefined) answer = await fetched(request, true, signal)
        else {
            ;(started as Record<string, Early | undefined>)[request.key] =
                undefined
            await early.promise
            answer =
                early.body === undefined && early.text === undefined
                    ? await fetched(request, true, signal)
                    : early
        }
        if (method === 'GET')
            followRpc(address, args, answer.version, answer.life, () =>
                (value as (args: unknown) => unknown)(args),
            )
        if (answer.body !== undefined && answer.body !== null) {
            yield* framedStream(answer.body, framingPrefix(answer.type))
            return
        }
        const value = answered(answer)
        if (isFailed(value)) throw value
        if (Array.isArray(value)) yield* value
    }
    // A KEYED VALUE OF ITS OWN where the handler's declares what its copy behaves by, so every entry —
    // the copy a page walks — carries it: its key (32.33), its tags (11.44), its retention (6.1) and
    // its comparator (5.3). A `GET` alone: a mutation's value is written and read once.
    const produce = options?.stream === true ? streamed : body
    // A `GET`'S ENTRY IS LOOKED UP BY ITS FOLLOW through the value, not the `Rpc`: a call made with no
    // signal pins the load it reaches (16.53), and a frame from the server would pin one a page was
    // still free to abort.
    const value =
        method === 'GET' || options !== undefined
            ? reactive(
                  produce,
                  options === undefined ? undefined : copyOptions(options),
              )
            : produce
    const rpc = declare(method)(value)
    // 16.10 — the address `rpc.url` and `rpc.raw` build on.
    rpc.address = address
    return rpc
}

/**
 * The build's copy options as a value takes them, `structural` resolved to its function.
 *
 * Checked against the value's own types where they were written, on the server; here they are data.
 */
function copyOptions(options: CopyOptions): never {
    // `stream` is the wire's to read, and not an option a value takes.
    const { identity, stream: _, ...rest } = options
    return (
        identity === 'structural' ? { ...rest, identity: structural } : rest
    ) as never
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
 * An early call's answer with its body read as text, for a copy that is one value.
 *
 * The early-call script leaves a framed answer's body unread, which a streaming copy reads as it
 * lands and this one reads to the end.
 */
async function answerWithText(
    early: Early,
    request: RpcRequest,
    signal: AbortSignal | undefined,
): Promise<Answer> {
    if (early.text !== undefined) return early
    if (early.body === undefined || early.body === null)
        return fetched(request, false, signal)
    return {
        ...early,
        text: await new Response(early.body).text(),
        body: undefined,
    }
}

/**
 * What precedes a chunk's JSON on its line: nothing for jsonl, `data: ` for sse, and `null` where
 * the answer is not framed at all.
 */
function framingPrefix(type: string | null | undefined): string | null {
    if (type?.startsWith('application/jsonl')) return ''
    if (type?.startsWith('text/event-stream')) return 'data: '
    return null
}

/**
 * A framed body's chunks, yielded as each line completes.
 *
 * Cancelled when the copy stops reading — a refresh starts a new run and the old one's reader has
 * nothing left to hand anything.
 */
async function* framedStream(
    body: ReadableStream<Uint8Array>,
    prefix: string | null,
): AsyncGenerator<unknown> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    try {
        for (;;) {
            const { done, value } = await reader.read()
            buffered += done
                ? decoder.decode()
                : decoder.decode(value, { stream: true })
            let newline = buffered.indexOf('\n')
            while (newline !== -1 || (done && buffered !== '')) {
                const end = newline === -1 ? buffered.length : newline
                const line = buffered.slice(0, end)
                buffered = buffered.slice(end + 1)
                if (line !== '' && line.startsWith(prefix ?? ''))
                    yield JSON.parse(line.slice((prefix ?? '').length))
                newline = buffered.indexOf('\n')
            }
            if (done) return
        }
    } finally {
        void reader.cancel().catch(() => {})
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
function answered(answer: Answer): unknown {
    const status = answer.status ?? 0
    if (status === 204) return undefined
    const type = answer.type ?? ''
    if (status >= 200 && status < 300) {
        if (type.startsWith('application/jsonl'))
            return framedChunks(answer.text ?? '', '')
        if (type.startsWith('text/event-stream'))
            return framedChunks(answer.text ?? '', 'data: ')
    }
    let body: unknown
    try {
        body = answer.text === '' ? undefined : JSON.parse(answer.text ?? '')
    } catch {
        body = undefined
    }
    if (status >= 200 && status < 300) return body
    if (isFailed(body))
        return failed(body.name, body.status, body.message, body.data)
    return refuse(status, answer.statusText || undefined)
}

/** One JSON value per line — the whole line for jsonl, the `data:` line of each event for sse. */
function framedChunks(text: string, prefix: string): unknown[] {
    const chunks: unknown[] = []
    for (const line of text.split('\n')) {
        if (line === '' || !line.startsWith(prefix)) continue
        chunks.push(JSON.parse(line.slice(prefix.length)))
    }
    return chunks
}

// 18.2 — a socket's wrapper, from the same entry, since only a generated wrapper imports either.
export { socketWire } from './socketWire.ts'
