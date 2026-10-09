// 16.33 — A FRAMED ANSWER, read one JSON value per line: the whole line for jsonl, the `data:` line of
// each event for sse. A line that does not carry the prefix — an sse `event:` line, a blank line — is
// skipped. One line reader behind both a body read to the end and one read as it lands.

/**
 * What precedes a chunk's JSON on its line: nothing for jsonl, `data: ` for sse, and `null` where
 * the answer is not framed at all.
 */
export function framingPrefix(type: string | null | undefined): string | null {
    if (type?.startsWith('application/jsonl')) return ''
    if (type?.startsWith('text/event-stream')) return 'data: '
    return null
}

/**
 * Whether an answer at `type` is read as bytes rather than as JSON: anything neither JSON nor framed.
 *
 * 16.35 — A BINARY IS `application/octet-stream`, OR A `Blob`'s OWN TYPE, so the bytes are named by
 * what an answer is not rather than by one type. An answer naming no type is read as JSON.
 */
export function carriesBytes(type: string | null | undefined): boolean {
    if (type === null || type === undefined || type === '') return false
    if (framingPrefix(type) !== null) return false
    const semicolon = type.indexOf(';')
    const essence = semicolon === -1 ? type : type.slice(0, semicolon)
    return essence !== 'application/json' && !essence.endsWith('+json')
}

/**
 * A streamed answer's chunks: each JSON value its framing carried, or, for bytes (16.47), each
 * `Uint8Array` as it was read — bytes have no framing to split them back into the chunks the
 * handler yielded.
 */
export function answerChunks(
    body: ReadableStream<Uint8Array>,
    type: string | null | undefined,
): AsyncIterable<unknown> {
    return carriesBytes(type)
        ? bytesStream(body)
        : framedStream(body, framingPrefix(type) ?? '')
}

/**
 * A body's reads, yielded as they land.
 *
 * Through a reader rather than the stream's own async iterator, which not every browser ships.
 */
async function* bytesStream(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
    const reader = body.getReader()
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) return
            yield value
        }
    } finally {
        void reader.cancel().catch(() => {})
    }
}

/** The chunks a framed text carried, every line of it complete. */
export function framedChunks(text: string, prefix: string): unknown[] {
    const chunks: unknown[] = []
    readLines(text, prefix, true, chunks)
    return chunks
}

/**
 * A framed body's chunks, yielded as each line completes.
 *
 * Cancelled when the reader stops reading — a refresh starts a new run and the old one's reader has
 * nothing left to hand anything.
 */
export async function* framedStream(
    body: ReadableStream<Uint8Array>,
    prefix: string,
): AsyncGenerator<unknown> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const chunks: unknown[] = []
    let buffered = ''
    try {
        for (;;) {
            const { done, value } = await reader.read()
            buffered = readLines(
                buffered +
                    (done
                        ? decoder.decode()
                        : decoder.decode(value, { stream: true })),
                prefix,
                done,
                chunks,
            )
            yield* chunks
            chunks.length = 0
            if (done) return
        }
    } finally {
        void reader.cancel().catch(() => {})
    }
}

/**
 * Parses each complete line of `text` into `chunks`, and the unfinished last one too where `ended`.
 *
 * Answers what is left of `text` after the last newline.
 */
function readLines(
    text: string,
    prefix: string,
    ended: boolean,
    chunks: unknown[],
): string {
    let start = 0
    for (;;) {
        const newline = text.indexOf('\n', start)
        if (newline === -1 && !ended) return text.slice(start)
        const end = newline === -1 ? text.length : newline
        if (end > start && text.startsWith(prefix, start))
            chunks.push(JSON.parse(text.slice(start + prefix.length, end)))
        if (newline === -1) return ''
        start = newline + 1
    }
}
