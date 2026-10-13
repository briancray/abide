// WHAT A HANDLER'S VALUE IS ANSWERED AS, over http. JSON by default (16.30), and otherwise by what the
// value is: a `Response` as it stands (16.36), a binary as bytes (16.34), a `Blob` range-aware
// (16.35), a document where `page` named one (17.2), a stream — a streaming handler's chunks, or
// `Values` a handler returned — framed one chunk per pull (16.32, 16.44–16.47).

import { isFailed, problemOf } from '#shared/Failed.ts'
import { refusalFrame } from '#shared/framing.ts'
import { compressAnswer } from './compressAnswer.ts'
import { prefers } from './prefers.ts'
import {
    currentRequestScope,
    type Framing,
    heldByApp,
    holdScope,
} from './requestScope.ts'

const ENCODER = new TextEncoder()
// AN EVENT STREAM OPENS ON A COMMENT — `bodyOf` says why.
const SSE_OPENER = ':\n\n'

function isValues(
    value: unknown,
): value is AsyncIterable<unknown> | ReadableStream<unknown> {
    return (
        value instanceof ReadableStream ||
        (value !== null &&
            typeof value === 'object' &&
            Symbol.asyncIterator in (value as object))
    )
}

/** The `Response` a handler's value is answered as. */
export async function answerValue(
    value: unknown,
    request: Request,
    headers: Headers,
    status: number,
): Promise<Response> {
    if (value instanceof Response) return value
    const framing = currentRequestScope()?.framing
    // 17.9, 17.10 — what `json` fixed: the standing value, whatever it is, and `null` for nothing.
    if (framing === 'json') {
        headers.set('content-type', 'application/json')
        return compressAnswer(
            JSON.stringify(value ?? null),
            request,
            headers,
            status,
        )
    }
    // 16.31 — nothing to say is 204, where the handler wrote no status of its own, and 16.52 — a
    // type for no content is noise, at any status: a `redirect` has no body for it to describe.
    if (value === undefined) {
        headers.delete('content-type')
        return new Response(null, {
            status: status === 200 ? 204 : status,
            headers,
        })
    }
    if (value instanceof Blob)
        return answerBlobTagged(
            value,
            await etagOf(value),
            request,
            headers,
            status,
        )
    // 17.2 — the document `page` named: text, the bytes `render` hands back, or a stream of bytes.
    if (framing === 'html') {
        headers.set('content-type', 'text/html; charset=utf-8')
        if (typeof value === 'string' || value instanceof Uint8Array)
            return new Response(value as BodyInit, { status, headers })
        return new Response(bodyOf(chunksOf(value), 'bytes'), {
            status,
            headers,
        })
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        headers.set('content-type', 'application/octet-stream')
        return new Response(value as BodyInit, { status, headers })
    }
    // A sync iterable is a stream only where a helper fixed the framing: an array is a value.
    if (isValues(value) || (framing !== undefined && isIterable(value)))
        return answerStream(chunksOf(value), framing, request, headers, status)
    // 16.30.
    return compressAnswer(JSON.stringify(value), request, headers, status)
}

function isIterable(value: unknown): value is Iterable<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        Symbol.iterator in (value as object)
    )
}

/**
 * The head of an event stream. 16.45 — never stored, whatever the value's own life said (21.8), and
 * never buffered by a proxy in front.
 */
export function sseHeaders(headers: Headers): void {
    headers.set('content-type', 'text/event-stream')
    headers.set('cache-control', 'no-cache')
    headers.set('x-accel-buffering', 'no')
}

/**
 * An async iterator over a stream value's chunks.
 *
 * AN ASYNC ITERABLE IS READ THROUGH ITS OWN ITERATOR — a `ReadableStream` is one in bun — rather
 * than through a generator delegating to it, which is one more resumption per chunk. A sync
 * iterable is lifted, which also awaits a promise it holds.
 */
function chunksOf(value: unknown): AsyncIterator<unknown> {
    if (Symbol.asyncIterator in (value as object))
        return (value as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    return lifted(value as Iterable<unknown>)
}

async function* lifted(value: Iterable<unknown>): AsyncGenerator<unknown> {
    yield* value
}

/**
 * A stream answered at the framing a helper fixed, or the first the first chunk's type admits.
 *
 * 16.32, 16.46, 16.47 — binary chunks admit bytes alone, and values admit jsonl and then sse, sse
 * where `Accept` asks for it.
 */
async function answerStream(
    chunks: AsyncIterator<unknown>,
    fixed: Framing | undefined,
    request: Request,
    headers: Headers,
    status: number,
): Promise<Response> {
    const first = await chunks.next()
    return framed(
        chunks,
        fixed ??
            (first.done !== true && first.value instanceof Uint8Array
                ? 'bytes'
                : prefers(request, 'text/event-stream', 'application/jsonl')
                  ? 'sse'
                  : 'jsonl'),
        headers,
        status,
        first,
        linesType(request),
    )
}

/**
 * The type one JSON value per line is answered as: NDJSON's where the reader asks for it by that
 * name, and `application/jsonl` otherwise — the same bytes either way (16.45).
 */
export function linesType(request: Request): string {
    return prefers(request, 'application/x-ndjson', 'application/jsonl')
        ? 'application/x-ndjson'
        : 'application/jsonl'
}

/** A stream answered at a framing already decided — a handler's. */
export function framed(
    chunks: AsyncIterator<unknown>,
    framing: Framing,
    headers: Headers,
    status: number,
    first?: IteratorResult<unknown>,
    lines = 'application/jsonl',
): Response {
    if (framing === 'bytes')
        headers.set('content-type', 'application/octet-stream')
    else if (framing === 'jsonl') headers.set('content-type', lines)
    else sseHeaders(headers)
    return new Response(bodyOf(chunks, framing, first), {
        status,
        headers,
    })
}

/**
 * A response body writing each chunk as one frame of `framing`.
 *
 * 16.44, 16.45 — ONE FRAME PER PULL, so a reader sees each chunk as it is produced rather than
 * once the stream has finished. A reader who hangs up returns the generator, which stops what it
 * was reading in its scope.
 *
 * AN EVENT STREAM OPENS ON A COMMENT: a streamed answer's head goes out with its first byte, so a
 * stream with nothing yet to say held its reader's headers until it did.
 *
 * `first` is a result already pulled — the one a framing was decided from — and is sent ahead of
 * the rest.
 *
 * 42.11 — A BODY STILL BEING WRITTEN WHEN THE APP STOPS IS ENDED: its generator returned and its
 * reader handed the end of the stream, rather than left streaming into a process that has stopped.
 */
export function bodyOf(
    chunks: AsyncIterator<unknown>,
    framing: Framing,
    first?: IteratorResult<unknown>,
): ReadableStream<Uint8Array> {
    let pulled = first
    // 12.5 — the request's scope stays open while the body is read in it.
    const releaseHold = holdScope()
    let ended = false
    const release = (): void => {
        ended = true
        releaseHold()
        unhold()
    }
    let stopped = (): void => {}
    const unhold = heldByApp(() => stopped())
    return new ReadableStream<Uint8Array>({
        start(controller) {
            if (framing === 'sse')
                controller.enqueue(ENCODER.encode(SSE_OPENER))
            stopped = () => {
                if (ended) return
                release()
                void chunks.return?.(undefined)
                controller.close()
            }
        },
        async pull(controller) {
            let next: IteratorResult<unknown>
            if (pulled !== undefined) {
                next = pulled
                pulled = undefined
            } else
                try {
                    next = await chunks.next()
                } catch (thrown) {
                    if (ended) return
                    // 16.68 — A REFUSAL AFTER THE STATUS WAS SENT is the stream's last frame, so the
                    // reader refuses with it rather than reading a dropped connection. Bytes carry no
                    // framing to hold one, and anything else is not a refusal to send.
                    if (framing !== 'bytes' && isFailed(thrown)) {
                        controller.enqueue(
                            ENCODER.encode(
                                refusalFrame(
                                    problemOf(thrown),
                                    framing === 'sse' ? 'data: ' : '',
                                ),
                            ),
                        )
                        controller.close()
                    } else controller.error(thrown)
                    release()
                    return
                }
            // Ended by the app's stop while this pull waited on the chunk.
            if (ended) return
            if (next.done === true) {
                controller.close()
                release()
                return
            }
            const chunk = next.value
            if (framing === 'bytes')
                controller.enqueue(
                    chunk instanceof Uint8Array
                        ? chunk
                        : ENCODER.encode(String(chunk)),
                )
            else if (framing === 'jsonl')
                controller.enqueue(ENCODER.encode(`${JSON.stringify(chunk)}\n`))
            else
                controller.enqueue(
                    ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`),
                )
        },
        cancel() {
            void chunks.return?.(undefined)
            release()
        },
    })
}

/**
 * A blob answered at its own type under the given etag, range-aware.
 *
 * 16.34, 16.35 — `If-None-Match` answered 304, one `Range` answered 206 — or 416 where it lies
 * past the end — and `If-Range` naming another version answered in full. The body is the blob
 * itself, or a slice of it, so a file is sent from disk rather than through a copy in memory. The
 * etag is handed in, because a public file's was read at boot (21.13).
 */
export function answerBlobTagged(
    blob: Blob,
    etag: string,
    request: Request,
    headers: Headers,
    status: number,
): Response {
    headers.set(
        'content-type',
        blob.type === '' ? 'application/octet-stream' : blob.type,
    )
    headers.set('etag', etag)
    headers.set('accept-ranges', 'bytes')
    if (namesEtag(request.headers.get('if-none-match'), etag))
        return new Response(null, { status: 304, headers })
    const range = request.headers.get('range')
    const ifRange = request.headers.get('if-range')
    const size = blob.size
    if (range !== null && (ifRange === null || ifRange === etag)) {
        const asked = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
        if (asked !== null && (asked[1] !== '' || asked[2] !== '')) {
            let start: number
            let end: number
            if (asked[1] === '') {
                start = Math.max(0, size - Number(asked[2]))
                end = size - 1
            } else {
                start = Number(asked[1])
                end =
                    asked[2] === ''
                        ? size - 1
                        : Math.min(Number(asked[2]), size - 1)
            }
            if (start >= size || start > end) {
                headers.set('content-range', `bytes */${size}`)
                return new Response(null, { status: 416, headers })
            }
            headers.set('content-range', `bytes ${start}-${end}/${size}`)
            return new Response(blob.slice(start, end + 1), {
                status: 206,
                headers,
            })
        }
    }
    // A RANGE DECLINED — `If-Range` naming another version, or one this does not parse — goes out
    // whole as the blob itself: Bun.serve ranges a file-backed body on its own, but declines exactly
    // these, so a file still leaves from disk.
    return new Response(blob, { status, headers })
}

/**
 * Whether an `If-None-Match` header names `etag`, compared weakly.
 *
 * 21.14 — WEAK COMPARISON, which is what `If-None-Match` is defined to use: a proxy compressing on
 * the way out weakens the etag, and the browser sends back the `W/` form. `If-Range` compares
 * strongly, and stays an equality.
 */
export function namesEtag(header: string | null, etag: string): boolean {
    if (header === null) return false
    for (const listed of header.split(',')) {
        const tag = listed.trim()
        if (tag === '*' || tag === etag || tag === `W/${etag}`) return true
    }
    return false
}

/**
 * The blob's etag: a file's by its path, size and write time, anything else's by its bytes.
 *
 * THE ETAG 16.35 HONORS `If-Range` AGAINST. A whole file on disk is named by its path, size and
 * write time — a stat, so neither a 304 nor a Range reads the file to decide whether to. Anything
 * else is named by its bytes: a blob in memory has no other identity, and a slice of a file shares
 * the file's path and write time with every other slice of its size. A file that stats empty is
 * read too, which costs nothing where it is empty and throws where it is missing — inside the
 * handler's answer, as 16.41 answers it, rather than out of the server's send.
 */
async function etagOf(blob: Blob): Promise<string> {
    // A file `Bun.file` made carries its path as `name` and its write time as `lastModified`.
    const { name: path, lastModified } = blob as {
        name?: unknown
        lastModified?: number
    }
    if (
        typeof path === 'string' &&
        blob.size > 0 &&
        !(blob instanceof File) &&
        Bun.file(path).size === blob.size
    )
        return `"${Bun.hash(`${path}:${blob.size}:${lastModified}`).toString(16)}"`
    return contentEtag(await blob.bytes())
}

/**
 * An etag naming `bytes` by a hash of them.
 *
 * Non-cryptographic, and that is the right tool: an etag answers "are these the same bytes", not
 * "could somebody forge these bytes".
 */
export function contentEtag(bytes: Uint8Array): string {
    return `"${Bun.hash(bytes).toString(16)}"`
}
