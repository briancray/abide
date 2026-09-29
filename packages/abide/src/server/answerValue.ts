// WHAT A HANDLER'S VALUE IS ANSWERED AS, over http. JSON by default (16.31), and otherwise by what the
// value is: a `Response` as it stands (16.37), a binary as bytes (16.35), a `Blob` range-aware
// (16.36), a document where `page` named one (17.2), and a stream — a streaming handler's chunks, or
// `Values` a handler returned — framed one chunk per pull (16.33, 16.46–16.49).
//
// NOT HERE YET: 16.50–16.52, a `history` value's sequence numbers on the wire, which wait on the
// socket lane that mints them; and 16.34's transcript of a stream in the seed buffer.

import { chunksFrom } from '#shared/reactive/index.ts'
import { prefers } from './prefers.ts'
import { currentRequestScope, type Framing } from './requestScope.ts'

const ENCODER = new TextEncoder()

// THE CHUNKS OF A STREAMING VALUE, AS THEY LAND, ENDING WHEN ITS RUN CLOSES. The live cursor is the
// wake and not the source: a cursor outlives the run (it waits on the next one), and a chunk landing
// in the same turn as the close could be lost to whichever settled first — so each wake sends what
// the accumulation holds past what has already gone, and the close sends the rest.
export async function* chunksOfStream(value: unknown): AsyncGenerator<unknown> {
    const stream = value as PromiseLike<unknown> & AsyncIterable<unknown>
    let closed = false
    let failure: unknown
    // ONE REACTION ON THE CLOSE FOR THE WHOLE STREAM, which wakes whichever wait is current. A
    // `Promise.race` against the close per chunk left one reaction per chunk on it, held until the
    // stream ended.
    let wake: () => void = () => {}
    void Promise.resolve(stream).then(
        () => {
            closed = true
            wake()
        },
        (error: unknown) => {
            closed = true
            failure = error
            wake()
        },
    )
    const cursor = stream[Symbol.asyncIterator]()
    let sent = 0
    let woken = cursor.next()
    try {
        for (;;) {
            if (!closed)
                await new Promise<void>((resolve, reject) => {
                    wake = resolve
                    woken.then(() => resolve(), reject)
                })
            for (const chunk of chunksFrom(value, sent)) {
                sent += 1
                yield chunk
            }
            if (closed) break
            woken = cursor.next()
        }
    } finally {
        void cursor.return?.(undefined)
    }
    if (failure !== undefined) throw failure
}

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

export async function answerValue(
    value: unknown,
    request: Request,
    headers: Headers,
    status: number,
): Promise<Response> {
    if (value instanceof Response) return value
    const framing = currentRequestScope()?.framing
    // 16.32 — nothing to say is 204, where the handler wrote no status of its own, and 16.57 — a
    // type for no content is noise.
    if (value === undefined) {
        if (status === 200) headers.delete('content-type')
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
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        headers.set('content-type', 'application/octet-stream')
        return new Response(value as BodyInit, { status, headers })
    }
    // A sync iterable is a stream only where a helper fixed the framing: an array is a value.
    if (isValues(value) || (framing !== undefined && isIterable(value)))
        return answerStream(chunksOf(value), framing, request, headers, status)
    // 16.31.
    return new Response(JSON.stringify(value), { status, headers })
}

function isIterable(value: unknown): value is Iterable<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        Symbol.iterator in (value as object)
    )
}

// AN ASYNC ITERABLE IS READ THROUGH ITS OWN ITERATOR — a `ReadableStream` is one in bun — rather than
// through a generator delegating to it, which is one more resumption per chunk. A sync iterable is
// lifted, which also awaits a promise it holds.
function chunksOf(value: unknown): AsyncIterator<unknown> {
    if (Symbol.asyncIterator in (value as object))
        return (value as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    return lifted(value as Iterable<unknown>)
}

async function* lifted(value: Iterable<unknown>): AsyncGenerator<unknown> {
    yield* value
}

// 16.33, 16.48, 16.49 — THE FRAMING a helper fixed, or the first the first chunk's type admits:
// binary chunks admit bytes alone, and values admit jsonl and then sse, sse where `Accept` asks for it.
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
    )
}

// A stream answered at a framing already decided — a handler's, and `log.records` (36.7).
export function framed(
    chunks: AsyncIterator<unknown>,
    framing: Framing,
    headers: Headers,
    status: number,
    first?: IteratorResult<unknown>,
): Response {
    if (framing === 'bytes')
        headers.set('content-type', 'application/octet-stream')
    else if (framing === 'jsonl')
        headers.set('content-type', 'application/jsonl')
    else {
        // 16.47.
        headers.set('content-type', 'text/event-stream')
        headers.set('cache-control', 'no-cache')
        headers.set('x-accel-buffering', 'no')
    }
    return new Response(bodyOf(chunks, framing, first), {
        status,
        headers,
    })
}

// 16.46, 16.47 — ONE FRAME PER PULL, so a reader sees each chunk as it is produced rather than once
// the stream has finished. A reader who hangs up returns the generator, which stops what it
// was reading in its scope.
//
// AN EVENT STREAM OPENS ON A COMMENT: a streamed answer's head goes out with its first byte, so a
// stream with nothing yet to say — an empty `log.records` — held its reader's headers until it did.
//
// `first` is a result already pulled — the one a framing was decided from — and is sent ahead of the
// rest.
export function bodyOf(
    chunks: AsyncIterator<unknown>,
    framing: Framing,
    first?: IteratorResult<unknown>,
): ReadableStream<Uint8Array> {
    let pulled = first
    return new ReadableStream<Uint8Array>({
        start(controller) {
            if (framing === 'sse') controller.enqueue(ENCODER.encode(':\n\n'))
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
                    controller.error(thrown)
                    return
                }
            if (next.done === true) {
                controller.close()
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
        },
    })
}

// 16.35, 16.36 — A BLOB, AT ITS OWN TYPE AND RANGE-AWARE: `If-None-Match` answered 304, one `Range`
// answered 206 — or 416 where it lies past the end — and `If-Range` naming another version answered in
// full. The body is the blob itself, or a slice of it, so a file is sent from disk rather than
// through a copy in memory. The etag is handed in, because a public file's was read at boot (21.13).
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
    // A RANGE DECLINED — `If-Range` naming another version, or one this does not parse. Bun.serve
    // ranges a file-backed 200 body on its own and reads no `If-Range` when it does, so the file, or
    // its `stream()`, would go out 206 anyway; piped, the body is no longer one it can see is a file.
    const body =
        range === null ? blob : blob.stream().pipeThrough(new TransformStream())
    return new Response(body, { status, headers })
}

// 21.14 — WEAK COMPARISON, which is what `If-None-Match` is defined to use: a proxy compressing on
// the way out weakens the etag, and the browser sends back the `W/` form. `If-Range` compares
// strongly, and stays an equality.
function namesEtag(header: string | null, etag: string): boolean {
    if (header === null) return false
    for (const listed of header.split(',')) {
        const tag = listed.trim()
        if (tag === '*' || tag === etag || tag === `W/${etag}`) return true
    }
    return false
}

// THE ETAG 16.36 HONORS `If-Range` AGAINST. A whole file on disk is named by its path, size and write
// time — a stat, so neither a 304 nor a Range reads the file to decide whether to. Anything else is
// named by its bytes: a blob in memory has no other identity, and a slice of a file shares the file's
// path and write time with every other slice of its size. A file that stats empty is read too, which
// costs nothing where it is empty and throws where it is missing — inside the handler's answer, as
// 16.43 answers it, rather than out of the server's send.
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

// Non-cryptographic, and that is the right tool: an etag answers "are these the same bytes", not
// "could somebody forge these bytes".
export function contentEtag(bytes: Uint8Array): string {
    return `"${Bun.hash(bytes).toString(16)}"`
}
