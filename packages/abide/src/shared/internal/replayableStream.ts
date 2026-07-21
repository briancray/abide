// ReplayableStream — the consume-once, buffer-decoded-chunks, fan-out replay-then-live core
// (replayable-streams.md §4, build step 1a).
//
// A single source is consumed once; every decoded chunk is appended to a shared, append-only
// `chunks` buffer. Each consumer walks that buffer with its OWN cursor via `consume()`: it replays
// the chunks so far, then goes live for the rest until a terminal (done / error / aborted). Replay
// and live are the SAME read — a lagging consumer just reads the shared array slower; nothing is
// ever dropped for a finite stream (unlike the socket tail's drop-oldest fan-out).
//
// This primitive is cell-independent: it owns no cache slot, no TTL, no LRU. The cell wires it into
// a slot (close/fail stamp the slot clock, per-consume ref-counting drives disposal) in step 1b.

// Byte size of one decoded chunk, for the transcript accounting the cell/LRU will consume later.
// A non-serializable chunk contributes 0 rather than throwing — accounting is best-effort.
function measureChunkBytes(chunk: unknown): number {
    try {
        const encoded = JSON.stringify(chunk)
        return encoded === undefined ? 0 : encoded.length
    } catch {
        return 0
    }
}

// Lifecycle hooks the cell wires in; all optional so the standalone primitive needs none.
export interface ReplayableStreamHooks {
    onAbort?: () => void
    onRefCountZero?: () => void
    onPush?: () => void
}

export class ReplayableStream<T> {
    // The full transcript so far — append-only, shared by all consumers (each reads it by cursor).
    readonly chunks: T[] = []
    // Terminals. `done` and `errored`/`aborted` are mutually exclusive; `chunks` is frozen once set.
    done = false
    errored = false
    error: unknown = undefined
    aborted = false
    // Running Σ measureChunkBytes(chunk), for LRU / per-stream-cap accounting.
    bytes = 0
    // Exceeded the per-stream buffer cap (replayable-streams.md §4). An overflowed stream is aborted
    // (bounded memory), drops replay eligibility, and a new read re-runs instead of replaying.
    overflowed = false
    // Live attachments currently iterating a `consume()`. Drives the cell's dispose-on-drain (step 1b).
    refCount = 0
    // Bumped by a future amend/rewrite so cursors re-replay from 0 (append verb deferred; see spec).
    generation = 0
    // Transport encoding the handler chose (jsonl(...) / sse(...)), carried so the router re-serves the
    // same wire format after replay. Undefined for a bare async-generator source (router defaults jsonl).
    encoding: 'jsonl' | 'sse' | undefined = undefined

    // Pending wake callbacks — one shared list, resolved-and-cleared on every push/terminal. A caught-up
    // consumer parks here; it is NOT a per-consumer queue, so there is no queue to overflow or drop from.
    private waiters: Array<() => void> = []
    // Aborts the owning source (its AbortController), invoked once on abort(). Optional for a standalone
    // stream with no source to cancel.
    private readonly onAbort: (() => void) | undefined
    // Fired whenever the live ref-count returns to 0 (after any consumer detaches). The cell uses this to
    // drive TTL-keyed lifecycle: dispose-on-drain for a settled slot, or abort a source everyone left.
    private readonly onRefCountZero: (() => void) | undefined
    // Fired after each chunk is appended. The cell uses this to bump a reactive tick so `latest`/`chunks`
    // re-run as the transcript grows — WITHOUT touching the state-machine signal the bare read subscribes.
    private readonly onPush: (() => void) | undefined

    constructor(hooks: ReplayableStreamHooks = {}) {
        this.onAbort = hooks.onAbort
        this.onRefCountZero = hooks.onRefCountZero
        this.onPush = hooks.onPush
    }

    get settled(): boolean {
        return this.done || this.errored || this.aborted
    }

    // Append one decoded chunk and wake parked consumers. A no-op once settled (the transcript is frozen).
    push(chunk: T): void {
        if (this.settled) return
        this.chunks.push(chunk)
        this.bytes += measureChunkBytes(chunk)
        this.wake()
        this.onPush?.()
    }

    // Terminal: the source ended normally. Consumers drain any remaining chunks, then end.
    close(): void {
        if (this.settled) return
        this.done = true
        this.wake()
    }

    // Terminal: the source failed. Consumers replay chunks-so-far, then throw `err`.
    fail(err: unknown): void {
        if (this.settled) return
        this.errored = true
        this.error = err
        this.wake()
    }

    // Terminal: torn down by policy / invalidate. Consumers replay chunks-so-far, then end (no throw).
    // Aborts the owning source exactly once.
    abort(): void {
        if (this.settled) return
        this.aborted = true
        this.wake()
        this.onAbort?.()
    }

    // The transcript exceeded its per-stream cap: bound memory by aborting the source, and flag it so the
    // cell drops replay eligibility (a new read re-runs). Buffered chunks stay for current consumers.
    markOverflowed(): void {
        if (this.overflowed) return
        this.overflowed = true
        this.abort()
    }

    // A fresh cursor view — one per consumer. Replays `chunks` in order, then parks for live pushes
    // until a terminal. Ref-counted for the lifetime of active iteration (start → return/throw/exhaust).
    //
    // Atomicity: the caught-up check (`i < chunks.length`), the terminal check, and parking a waiter run
    // with no `await` between them, so a chunk or terminal arriving in the join window is never missed and
    // a joiner never blocks on a terminal that already fired (single-threaded microtask ordering).
    async *consume(from = 0): AsyncGenerator<T, void, void> {
        this.refCount++
        try {
            let i = from > 0 ? from : 0
            for (;;) {
                while (i < this.chunks.length) {
                    yield this.chunks[i++] as T
                }
                if (this.errored) throw this.error
                if (this.done || this.aborted) return
                await new Promise<void>((resolve) => {
                    this.waiters.push(resolve)
                })
            }
        } finally {
            this.refCount--
            if (this.refCount === 0) this.onRefCountZero?.()
        }
    }

    private wake(): void {
        if (this.waiters.length === 0) return
        const pending = this.waiters
        this.waiters = []
        for (const resolve of pending) resolve()
    }
}
