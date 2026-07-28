// logFeed — the process-local fan-out behind `/__abide/logs` and a compiled binary's `logs` subcommand:
// a bounded ring of the most recent records plus a set of live listeners.
//
// DELIBERATELY NOT A `channel`, despite `channel` already being a ring-buffered replay-then-live
// pub/sub with exactly the right `tail`/`maxAge` vocabulary. `log()` is called from INSIDE the reactive
// system — `abide:memo`, `abide:hydrate` and `abide:ssr` all log during reactive work — so publishing
// into a reactive hub from the emit path could wake readers in the middle of a computation that is
// itself the reason the line exists. A plain ring has no reactive coupling and cannot re-enter the
// graph. The cost is one small buffer that duplicates a capability; the alternative is a feedback edge
// from logging into the thing being logged.
//
// OFF BY DEFAULT, and `enabled` is a plain boolean rather than an env read because this sits on the
// hottest path the framework has. A deployment that never opts in pays exactly one property load per
// log line. One that does opt in buffers unconditionally — NOT only while someone is subscribed —
// because the backlog is the point: you run `logs` after noticing a problem, and a feed that starts
// empty at the moment you connect has thrown away the only lines you wanted.
//
// The server decides the policy (`ABIDE_LOGS`) and calls `enable()` at boot; nothing in `shared/` reads
// that variable, so the browser half of this module is unreachable code that never runs.

const DEFAULT_CAPACITY = 500

// One shape, always — every field is assigned on every record (an absent `traceparent` is an explicit
// `undefined`, which `JSON.stringify` drops on the wire anyway) so the ring stays monomorphic.
export interface LogRecord {
    seq: number
    level: string
    time: string
    channel: string
    traceparent: string | undefined
    message: string
}

export type LogListener = (record: LogRecord) => void

let buffer: (LogRecord | undefined)[] = []
let writeIndex = 0
let filled = false
let nextSeq = 1
let publishing = false

const listeners = new Set<LogListener>()

export const logFeed = {
    // Read on every log line before the record is even built — see the module note.
    enabled: false,

    enable(capacity: number = DEFAULT_CAPACITY): void {
        const size = capacity > 0 ? capacity : DEFAULT_CAPACITY
        if (buffer.length !== size) {
            buffer = new Array<LogRecord | undefined>(size)
            writeIndex = 0
            filled = false
        }
        logFeed.enabled = true
    },

    disable(): void {
        logFeed.enabled = false
        buffer = []
        writeIndex = 0
        filled = false
        listeners.clear()
    },

    // The sequence the NEXT record will carry. A subscriber that sees a gap between this and the
    // records it receives knows the ring evicted lines it never saw.
    sequence(): number {
        return nextSeq
    },

    publish(
        level: string,
        channel: string,
        message: string,
        traceparent: string | undefined,
        time: Date,
    ): void {
        if (!logFeed.enabled) return
        // A line emitted BY the feed's own transport must not feed back into it. Dropping the nested
        // line entirely (rather than buffering it un-fanned) is the only stable answer: anything that
        // keeps it alive keeps the edge alive. It still reaches stdout — the guard is on this fan-out,
        // not on logging.
        if (publishing) return

        const record: LogRecord = {
            seq: nextSeq++,
            level,
            time: time.toISOString(),
            channel,
            traceparent,
            message,
        }

        if (buffer.length > 0) {
            buffer[writeIndex] = record
            writeIndex = (writeIndex + 1) % buffer.length
            if (writeIndex === 0) filled = true
        }

        if (listeners.size === 0) return
        publishing = true
        try {
            for (const listener of listeners) {
                try {
                    listener(record)
                } catch {
                    // A broken subscriber must never take down the emit path — the line is already
                    // buffered, and a listener that throws is a transport problem, not a log problem.
                }
            }
        } finally {
            publishing = false
        }
    },

    subscribe(listener: LogListener): () => void {
        listeners.add(listener)
        return (): void => {
            listeners.delete(listener)
        }
    },

    subscriberCount(): number {
        return listeners.size
    },

    // Oldest-first, at most `limit`. `limit: 0` is a live-only subscriber asking for no history.
    backlog(limit: number): LogRecord[] {
        if (limit <= 0 || buffer.length === 0) return []
        const size = buffer.length
        const count = filled ? size : writeIndex
        const take = count < limit ? count : limit
        const start = filled ? writeIndex : 0
        const records: LogRecord[] = []
        for (let offset = count - take; offset < count; offset++) {
            const record = buffer[(start + offset) % size]
            if (record !== undefined) records.push(record)
        }
        return records
    },
}
