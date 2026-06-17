/* A retained record tagged with its monotonic sequence id, for SSE resume. */
export type BufferedRecord<Record> = { id: number; record: Record }

/*
A bounded ring of recent log records plus a live listener set. The framework's
single log tap feeds push(); each connected events stream replays the tail it
hasn't seen (by sequence id) then subscribes for new records. Capacity-bounded
so a long-lived server can't grow the buffer without limit — the inspector is a
tail, not a store (ADR 0004). Generic over the record so the package forwards
them opaquely as JSON, free of abide's internal LogRecord type.

`epoch` is minted per buffer instance: a dev worker swap creates a fresh buffer
whose ids restart at 1, so a client reconnecting with the previous worker's
Last-Event-ID must replay the tail rather than silently filter everything out —
the epoch is how the stream detects that mismatch.
*/
export function createEventBuffer<Record>(capacity: number) {
    const epoch = Math.random().toString(36).slice(2, 8)
    const entries: BufferedRecord<Record>[] = []
    const listeners = new Set<(entry: BufferedRecord<Record>) => void>()
    let sequence = 0

    // Tag, append (dropping the oldest past capacity), then fan out to live streams.
    function push(record: Record): void {
        const entry: BufferedRecord<Record> = { id: ++sequence, record }
        entries.push(entry)
        if (entries.length > capacity) {
            entries.shift()
        }
        // Isolate listeners: a stream whose controller has closed throws on
        // enqueue, and that must not abort delivery to the other listeners or
        // the framework's log tap.
        for (const listener of listeners) {
            try {
                listener(entry)
            } catch {
                // A throwing listener is treated as dead; it will unsubscribe on cancel.
            }
        }
    }

    // Retained entries newer than `afterId` (0 replays the whole tail).
    function since(afterId: number): BufferedRecord<Record>[] {
        return entries.filter((entry) => entry.id > afterId)
    }

    // Register a live listener; returns its unsubscribe.
    function subscribe(listener: (entry: BufferedRecord<Record>) => void): () => void {
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    }

    return { epoch, push, since, subscribe }
}
