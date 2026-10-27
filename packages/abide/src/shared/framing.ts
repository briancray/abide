// 16.32 — A FRAMED ANSWER, read one JSON value per frame: each line for jsonl, the `data` of each
// event for sse. One reader, `frameReader`, behind both a body read to the end and one read as it
// lands — and behind `abide watch`, which reads an event stream's events by name. The writer is the
// server's (`server/streamEvent.ts`).
//
// 16.68 — AND ITS LAST FRAME MAY BE A REFUSAL: one that reached the stream after it had answered, so
// after its status was sent. An sse `event: refusal` and the Problem Details as its `data`, or a
// jsonl line `{"$refusal": <Problem Details>}` — read here as the refusal, thrown where it lands.

import { failedFrom, isProblem } from './Failed.ts'
import { REFUSAL_KEY } from './REFUSAL_KEY.ts'

/** The two framings a streamed JSON answer is read in. 17.6. */
export type Framed = 'jsonl' | 'sse'

/** How an answer at `type` is framed, or `null` where it is not framed at all. */
export function framingOf(type: string | null | undefined): Framed | null {
    if (
        type?.startsWith('application/jsonl') ||
        type?.startsWith('application/x-ndjson')
    )
        return 'jsonl'
    if (type?.startsWith('text/event-stream')) return 'sse'
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
    if (framingOf(type) !== null) return false
    const essence = essenceOf(type)
    return essence !== 'application/json' && !essence.endsWith('+json')
}

/** A content type less its parameters, folded to lower case, as a type is compared; `''` for none. */
export function essenceOf(type: string | null | undefined): string {
    if (type === null || type === undefined) return ''
    const semicolon = type.indexOf(';')
    return (semicolon === -1 ? type : type.slice(0, semicolon))
        .trim()
        .toLowerCase()
}

/** One frame: an sse event's name — `message` where it named none — `id` and `data`, or a jsonl line. */
export type Frame = { name: string; id: string | undefined; data: string }

/**
 * A framed body's reader, fed its text as it arrives: pushes each frame the text completes onto
 * `frames` — and, where `ended`, the last one too.
 *
 * An event stream is read as the format says (18.27) — fields by name, a comment skipped, `data`
 * lines joined, the event ending at a blank line. A jsonl line is a frame with nothing but its data.
 * A closure over the read's own state, which is all it captures.
 */
function frameReader(
    lines: boolean,
): (text: string, ended: boolean, frames: Frame[]) => void {
    // The text after the last newline read, held until its line completes.
    let rest = ''
    let name = 'message'
    let id: string | undefined
    let data: string | undefined
    return (text, ended, frames) => {
        // A long line across many reads is held unscanned until its newline lands, or each read
        // rescans everything before it.
        if (!ended && !text.includes('\n')) {
            rest += text
            return
        }
        const read = (rest + text).split('\n')
        // The unfinished last line waits for the next read; at the end, a blank line ends it.
        rest = ended ? '' : (read.pop() as string)
        if (ended) read.push('')
        for (const line of read) {
            // A blank line ends an event; a jsonl line is one.
            if (lines || line === '') {
                const complete = lines ? line || undefined : data
                if (complete !== undefined)
                    frames.push({ name, id, data: complete })
                name = 'message'
                id = data = undefined
                continue
            }
            // A field and its value, the one space after the colon dropped and a CRLF's `\r` with
            // it; a line with no colon is a field with no value. A comment — an event stream's
            // opener — names the field ``, which is none.
            const colon = line.indexOf(':')
            const field = colon === -1 ? line : line.slice(0, colon)
            if (field !== 'data' && field !== 'event' && field !== 'id')
                continue
            let start = colon === -1 ? line.length : colon + 1
            if (line.charCodeAt(start) === 32) start += 1
            const value = line.slice(
                start,
                line.charCodeAt(line.length - 1) === 13
                    ? line.length - 1
                    : line.length,
            )
            if (field === 'data')
                data = data === undefined ? value : `${data}\n${value}`
            else if (field === 'event') name = value
            else id = value
        }
    }
}

/**
 * The chunk a frame carried, or — where it is a refusal (16.68) — that refusal, thrown.
 *
 * Per chunk: the reserved key is tested before any key list is built.
 */
function chunkOf(frame: Frame, lines: boolean): unknown {
    const value = JSON.parse(frame.data)
    const problem = !lines
        ? frame.name === 'refusal' && value
        : typeof value === 'object' &&
          Object.hasOwn(Object(value), REFUSAL_KEY) &&
          Object.keys(value).length === 1 &&
          value[REFUSAL_KEY]
    if (isProblem(problem)) throw failedFrom(problem)
    return value
}

/**
 * A streamed answer's chunks: each JSON value its `framing` carried, or, for bytes (16.46) — an
 * unread body with no framing — each `Uint8Array` as it was read: bytes have no framing to split
 * them back into the chunks the handler yielded.
 */
export function answerChunks(
    body: ReadableStream<Uint8Array>,
    framing: Framed | null,
): AsyncIterable<unknown> {
    return framing === null ? bytesStream(body) : framedStream(body, framing)
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

/** The chunks a framed text carried, every frame of it complete. */
export function framedChunks(text: string, framing: Framed): unknown[] {
    const lines = framing === 'jsonl'
    const frames: Frame[] = []
    frameReader(lines)(text, true, frames)
    return frames.map((frame) => chunkOf(frame, lines))
}

/** An event stream's events, yielded as each completes. */
export function eventsOf(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<Frame> {
    return framedStream(body, 'sse', true) as AsyncGenerator<Frame>
}

/**
 * A framed body's chunks — or, where `events`, its frames as they are — yielded as each frame
 * completes.
 *
 * Canceled when the reader stops reading — a refresh starts a new run and the old one's reader has
 * nothing left to hand anything.
 */
export async function* framedStream(
    body: ReadableStream<Uint8Array>,
    framing: Framed,
    events?: true,
): AsyncGenerator<unknown> {
    const lines = framing === 'jsonl'
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const framed = frameReader(lines)
    const frames: Frame[] = []
    try {
        for (;;) {
            const { done, value } = await reader.read()
            framed(
                done
                    ? decoder.decode()
                    : decoder.decode(value, { stream: true }),
                done,
                frames,
            )
            for (const frame of frames)
                yield events ? frame : chunkOf(frame, lines)
            frames.length = 0
            if (done) return
        }
    } finally {
        void reader.cancel().catch(() => {})
    }
}
