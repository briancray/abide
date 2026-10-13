// 16.32 — A FRAMED ANSWER, read one JSON value per line: the whole line for jsonl, the `data:` line of
// each event for sse. A line that does not carry the prefix — an sse `event:` line, a blank line — is
// skipped. One line reader behind both a body read to the end and one read as it lands.
//
// 16.68 — AND ITS LAST FRAME MAY BE A REFUSAL: one that reached the stream after it had answered, so
// after its status was sent. An sse `event: refusal` and the Problem Details on its `data:` line, or a
// jsonl line `{"$refusal": <Problem Details>}` — read here as the refusal, thrown where it lands.

import { failedFrom, isProblem, type Problem } from './Failed.ts'

/** The key a jsonl line carries a refusal under (16.68). */
const REFUSAL_KEY = '$refusal'

/** A framed stream's last frame, as the server writes it for a refusal (16.68). */
export function refusalFrame(problem: Problem, prefix: string): string {
    return prefix === ''
        ? `${JSON.stringify({ [REFUSAL_KEY]: problem })}\n`
        : `event: refusal\n${prefix}${JSON.stringify(problem)}\n\n`
}

// What a read of one framed body carries from one line to the next: whether an sse event named the
// data line after it a refusal.
type Reading = { refusal: boolean }

// A refusal's frame, read: thrown where it lands among the chunks.
class Refused {
    problem: Problem
    constructor(problem: Problem) {
        this.problem = problem
    }
}

/**
 * What precedes a chunk's JSON on its line: nothing for jsonl, `data: ` for sse, and `null` where
 * the answer is not framed at all.
 */
export function framingPrefix(type: string | null | undefined): string | null {
    if (
        type?.startsWith('application/jsonl') ||
        type?.startsWith('application/x-ndjson')
    )
        return ''
    if (type?.startsWith('text/event-stream')) return 'data: '
    return null
}

/**
 * Whether an answer at `type` is read as bytes rather than as JSON: anything neither JSON nor framed.
 *
 * 16.34 — A BINARY IS `application/octet-stream`, OR A `Blob`'s OWN TYPE, so the bytes are named by
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
 * A streamed answer's chunks: each JSON value its framing carried, or, for bytes (16.46), each
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
    readLines(text, prefix, true, chunks, { refusal: false })
    for (const chunk of chunks)
        if (chunk instanceof Refused) throw failedFrom(chunk.problem)
    return chunks
}

/**
 * A framed body's chunks, yielded as each line completes.
 *
 * Canceled when the reader stops reading — a refresh starts a new run and the old one's reader has
 * nothing left to hand anything.
 */
export async function* framedStream(
    body: ReadableStream<Uint8Array>,
    prefix: string,
): AsyncGenerator<unknown> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const chunks: unknown[] = []
    const reading: Reading = { refusal: false }
    let buffered = ''
    try {
        for (;;) {
            const { done, value } = await reader.read()
            const decoded = done
                ? decoder.decode()
                : decoder.decode(value, { stream: true })
            // A long line across many reads is held unscanned until its newline lands, or each read
            // rescans everything before it.
            if (!done && !decoded.includes('\n')) {
                buffered += decoded
                continue
            }
            buffered = readLines(
                buffered + decoded,
                prefix,
                done,
                chunks,
                reading,
            )
            for (const chunk of chunks) {
                if (chunk instanceof Refused) throw failedFrom(chunk.problem)
                yield chunk
            }
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
    reading: Reading,
): string {
    let start = 0
    for (;;) {
        const newline = text.indexOf('\n', start)
        if (newline === -1 && !ended) return text.slice(start)
        const end = newline === -1 ? text.length : newline
        if (prefix !== '' && text.startsWith('event: refusal', start))
            reading.refusal = true
        else if (end > start && text.startsWith(prefix, start)) {
            const value: unknown = JSON.parse(
                text.slice(start + prefix.length, end),
            )
            chunks.push(refusalIn(value, prefix, reading) ?? value)
            reading.refusal = false
        }
        if (newline === -1) return ''
        start = newline + 1
    }
}

// The refusal a value carries as its frame: the data line an sse event named one, or a jsonl line
// holding the one reserved key and Problem Details under it.
function refusalIn(
    value: unknown,
    prefix: string,
    reading: Reading,
): Refused | undefined {
    if (prefix !== '')
        return reading.refusal && isProblem(value)
            ? new Refused(value)
            : undefined
    // Per chunk: the reserved key is tested before any key list is built.
    if (
        value === null ||
        typeof value !== 'object' ||
        !Object.hasOwn(value, REFUSAL_KEY)
    )
        return undefined
    const keys = Object.keys(value)
    const problem = (value as Record<string, unknown>)[REFUSAL_KEY]
    return keys.length === 1 && isProblem(problem)
        ? new Refused(problem)
        : undefined
}
