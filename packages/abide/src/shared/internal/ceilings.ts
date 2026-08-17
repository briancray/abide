// The ceiling on a STREAM's transcript, and the one law every ceiling in abide is built to keep.
//
// A cap on retention must not become a cost on every write. `channel({ tail })` established that
// shape already — the buffer is pushed into and compacted once per `tail` messages, so raising a
// scrollback costs a publish nothing — and this is the same law over the other places a process grows
// without anyone deciding it should: a stream's TRANSCRIPT here, the process-wide memo cache in
// `cache.ts` (a separate module for a bundling reason its own header states), and how long a
// streaming render may run.
//
// All are unset by default, and unset has to be free. The env read is where each ceiling is declared
// — once per stream, once per settle, once per render that waits — so a process that declared none
// pays one property read at each of those moments and nothing at all on the paths in between: no
// charge, no LRU, no bookkeeping per chunk, none per select, and not even the timer the render budget
// would arm.
//
// Read where the ceiling could first matter rather than latched at import, for the reason
// `ABIDE_LOGS` and `ABIDE_LOG_BUFFER` are: a knob only readable before the module loaded is one an
// app cannot set from its own entry point, and one a test cannot exercise at all.
//
// A byte here is CHARGED, not measured. There are two charges below and they differ because the two
// MOMENTS differ, not because they disagree about what a byte is: a chunk's charge runs inside a
// stream's hot loop and is O(1) by contract, while a slot's runs once behind a load that already did
// real work and may walk the value. A charge that had to be exact would be the per-write cost the
// ceiling exists to avoid.

import { abideLog } from '../log.ts'
import { numberKnob } from './knobs.ts'

const streamLog = abideLog.channel('stream')

/**
 * What a value abide cannot size in the budget it has is charged.
 *
 * Something rather than nothing, deliberately: a slot charged zero is one the ceiling could never
 * evict, so an unmeasurable value would be the one thing that made the cap unenforceable.
 */
export const UNSIZED = 64

/** Per-stream transcript cap. Declared once per stream, so nothing per chunk reads the environment. */
export function streamCeiling(): number {
    return numberKnob('ABIDE_MAX_STREAM_BUFFER_SIZE')
}

/**
 * The charges both budgets answer EXACTLY and in O(1) — a string and the two binary shapes.
 *
 * `-1` where neither matches, so the caller decides what an unanswerable value costs: a chunk is
 * charged the flat overhead, a slot is worth a walk. That is the whole of what the two budgets
 * disagree about, and it is one branch rather than two copies of these three lines.
 */
export function exactCharge(value: unknown): number {
    if (typeof value === 'string') return value.length
    if (ArrayBuffer.isView(value)) return value.byteLength
    if (value instanceof ArrayBuffer) return value.byteLength
    return -1
}

/**
 * What one chunk is charged against a stream's transcript ceiling.
 *
 * O(1) by contract — this runs on every chunk. A string and a binary chunk are the two shapes a
 * stream actually carries and both answer exactly; anything else is charged the flat overhead rather
 * than stringified, because a `JSON.stringify` per chunk is precisely the per-write cost this is
 * here to bound.
 */
export function chunkCharge(chunk: unknown): number {
    const exact = exactCharge(chunk)
    return exact === -1 ? UNSIZED : exact
}

/**
 * Said once per stream that overflows, not once per chunk after it — the transcript is dropped on
 * the chunk that passed the cap and nothing is charged afterwards, so there is one event to report.
 *
 * A warning rather than a debug line: `DEBUG` gates volume, not breakage, and a transcript that
 * silently went empty is a reader being told the stream produced nothing.
 */
export function reportOverflow(charged: number, ceiling: number): void {
    streamLog.warning(
        `a stream passed ABIDE_MAX_STREAM_BUFFER_SIZE (${ceiling}) at ${charged} charged bytes — its transcript is dropped and chunks() replays nothing for the rest of it`,
    )
}
