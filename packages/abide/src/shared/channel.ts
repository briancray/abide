// `channel` — the third primitive: subscribe. `state` OWNS a value, `memo` LOADS one, `channel`
// RECEIVES them. It is the push face of the same atom, which is why it carries the same read
// vocabulary: iterate it, or call it.
//
// It is CALLABLE for the same reason a cell is — `feed()` is the latest message, subscribing the
// caller. A read has no second name here: every source spells it by being called.
//
// The reactive reads go through a `state` cell, so a component reading `feed()` re-renders on
// publish with no bridging code — the pub/sub side and the graph are not two systems.
//
// `channel<T, Args>()` splits the same stream into ROOMS. The call is what tells them apart: with no
// argument it is the read every source spells the same way, with one it selects a room and hands
// back an ordinary channel — exactly the shape `memo` already has, where `m()` is a value and
// `m(args)` is a slot.

import { markSource } from './internal/BRANDS.ts'
import { keyOf, matcher } from './internal/keys.ts'
import { isNamedError } from './internal/probes.ts'
import { arm } from './internal/timers.ts'
import { state, watch } from './reactive.ts'

interface Received<T> {
    latest: T | undefined
    /** When `latest` arrived. Only consulted under `maxAge`. */
    at: number
    /**
     * Messages oldest-first, PUSHED into rather than rebuilt per publish.
     *
     * Carries up to `tail + slack`, of which the LAST `tail` are the ones `chunks()` shows. The
     * slack is what makes a publish O(1) amortised: rebuilding the transcript per message cost a
     * copy of the whole retention every time, which is 1242 ns at `tail: 500` against 8 ns here.
     */
    buffer: T[]
    /** Arrival times, parallel to `buffer`. Only consulted under `maxAge`. */
    stamps: number[]
    /**
     * The live window as its own array, built on first ask and held for this version.
     *
     * A COPY, because the buffer keeps being pushed into — so `chunks()` still hands back a new
     * array after every publish and the same one between them, exactly as it did when the copy was
     * per publish. A channel nobody reads the transcript of now pays for none of them.
     */
    view: T[] | null
    got: boolean
}

// One shared empty array, so a `chunks()` reader on a channel with no retention sees the same
// identity every time and never wakes for it.
const NO_MESSAGES: never[] = []

const EMPTY: Received<never> = {
    latest: undefined,
    at: 0,
    buffer: NO_MESSAGES,
    stamps: NO_MESSAGES,
    view: NO_MESSAGES,
    got: false,
}

export interface Channel<T> {
    /** Latest message, reactive. Subscribes the caller. */
    (): T | undefined
    publish(message: T): void
    /** Latest message, subscribing to nothing. */
    peek(): T | undefined
    /** Session transcript, capped at `tail`. Reactive. */
    chunks(): T[]
    /** Reactive: has anything CURRENT arrived yet? */
    settled(): boolean
    /** Forget what has arrived. The verb means the same here as everywhere: this is no longer good. */
    invalidate(): void
    // A channel never loads, so these are always the cold answer — they are here so a reader can
    // treat any source alike rather than having to know which primitive it was handed.
    pending(): boolean
    refreshing(): boolean
    error(): unknown
    /** A channel is a stream that never ends, so this is true and `done()` is false, always. */
    streaming(): boolean
    done(): boolean
    isError(error: unknown, name: string): boolean
    /** Run `handler` with the latest message now, and again on every publish. Untracked, like `watch`. */
    // biome-ignore lint/suspicious/noConfusingVoidType: the union IS the contract — a handler either returns nothing or returns its teardown.
    watch(handler: (message: T | undefined) => void | (() => void)): () => void
    subscribe(listener: (message: T) => void): () => void
    /**
     * The transcript, then everything published after it, as one sequence that never ends.
     *
     * What iterating gives you plus the replay — the snapshot and the subscribe happen in the same
     * synchronous run, so a message published between them is missed by neither.
     */
    tail(): AsyncGenerator<T>
    [Symbol.asyncIterator](): AsyncIterator<T>
}

/** The `Args`-addressed form: the CALL selects a room, and everything else is read off the room. */
export interface RoomChannel<Args, T> {
    (args: Args): Channel<T>
    /**
     * Every room MATCHING the pattern — a subset of the args, compared the way rooms are keyed. No
     * pattern means every room, and the stream the bare `ch()` reads along with them.
     */
    invalidate(pattern?: Partial<Args>): void
}

export interface ChannelOptions {
    /** How many past messages `chunks()` retains. Default 0 — latest only. */
    tail?: number
    /**
     * ms a message counts as CURRENT for. Past it, it stops being the latest and leaves the
     * transcript, and the readers of both wake for it — a message that expired silently would leave
     * a reader showing something the channel no longer claims.
     */
    maxAge?: number
}

export function channel<T>(options?: ChannelOptions): Channel<T>
export function channel<T, Args>(options?: ChannelOptions): RoomChannel<Args, T>
export function channel<T, Args>(options: ChannelOptions = {}): Channel<T> & RoomChannel<Args, T> {
    const tail = options.tail ?? 0
    const maxAge = options.maxAge ?? Infinity
    // How far past `tail` the buffer may run before it compacts — what turns the copy from per
    // publish into once per `tail` publishes. NONE under `maxAge`: the timer arms for `stamps[0]` as
    // the oldest surviving message, so a message the tail has already evicted must not still be
    // sitting at the front claiming to be it.
    const slack = maxAge === Infinity ? tail : 0
    const listeners = new Set<(message: T) => void>()
    // One cell holds the whole observable state, so a publish is one wake, not two.
    const cell = state<Received<T>>(EMPTY as Received<T>)

    // Rooms are module-global rather than per-caller: a channel is not a cache. A server publishing
    // into a room has to reach subscribers that arrived on other requests, which is the whole point
    // of the primitive — a per-caller map would give each of them a private room nobody else writes.
    let rooms: Map<string, { args: Args; room: Channel<T> }> | null = null

    function roomFor(args: Args): Channel<T> {
        if (rooms === null) rooms = new Map()
        const key = keyOf(args)
        const held = rooms.get(key)
        if (held !== undefined) return held.room
        const room = channel<T>(options)
        rooms.set(key, { args, room })
        return room
    }

    // A channel is a SOURCE, so a slot reads it rather than rendering it. Without this the two
    // substrates disagreed: the server recurses through any function and printed the message, while
    // the client asks the brand and printed the channel's own source text.
    const self = markSource(((args?: Args) =>
        args === undefined ? cell().latest : roomFor(args)) as Channel<T> & RoomChannel<Args, T>)

    // --- expiry ------------------------------------------------------------
    //
    // A message goes stale by the passage of time, so something has to WAKE for it: a reader that
    // only found out on its next read would go on showing a message the channel stopped claiming.
    // One timer, armed for the OLDEST surviving message rather than the newest, so a transcript
    // drops its head at the right moment instead of all at once with the tail.

    let expiry: ReturnType<typeof setTimeout> | null = null

    function schedule(): void {
        if (expiry !== null) {
            clearTimeout(expiry)
            expiry = null
        }
        if (maxAge === Infinity) return
        const held = cell.peek()
        const oldest = held.stamps.length > 0 ? (held.stamps[0] as number) : held.got ? held.at : 0
        if (oldest === 0) return
        expiry = arm(expire, Math.max(0, oldest + maxAge - Date.now()))
    }

    function expire(): void {
        expiry = null
        const held = cell.peek()
        const now = Date.now()
        let drop = 0
        while (drop < held.stamps.length && now - (held.stamps[drop] as number) >= maxAge) drop++
        const staleLatest = held.got && now - held.at >= maxAge
        if (drop > 0 || staleLatest) {
            if (drop > 0) {
                held.buffer.splice(0, drop)
                held.stamps.splice(0, drop)
            }
            cell.set({
                latest: staleLatest ? undefined : held.latest,
                at: staleLatest ? 0 : held.at,
                buffer: held.buffer,
                stamps: held.stamps,
                view: drop > 0 ? null : held.view,
                got: !staleLatest,
            })
        }
        schedule()
    }

    self.publish = (message: T): void => {
        const held = cell.peek()
        const at = Date.now()
        let buffer = held.buffer
        let stamps = held.stamps
        // No retention means the transcript is never touched, so `chunks()` keeps handing back the
        // one shared empty array rather than a fresh one per publish.
        let view = held.view
        if (tail > 0) {
            // The empty transcript is SHARED. The first publish takes one of its own rather than
            // pushing into the constant every channel starts from.
            if (buffer === (NO_MESSAGES as unknown as T[])) {
                buffer = []
                stamps = []
            }
            buffer.push(message)
            stamps.push(at)
            if (buffer.length > tail + slack) {
                buffer.splice(0, buffer.length - tail)
                stamps.splice(0, stamps.length - tail)
            }
            view = null
        }
        cell.set({ latest: message, at, buffer, stamps, view, got: true })
        if (maxAge !== Infinity) schedule()
        // Delivery is against a SNAPSHOT: a listener that subscribes while this message is going out
        // must not receive it, and one that unsubscribes must still finish this round. The copy is
        // how that is spelled, and it costs an array per publish (32 ns against 18 ns) — so the two
        // sizes where a snapshot is provably the same thing as the live Set take the cheap path.
        // Nought and one are what a channel driving components actually holds.
        const size = listeners.size
        if (size === 0) return
        if (size === 1) {
            for (const listener of listeners) {
                listener(message)
                break
            }
            return
        }
        for (const listener of [...listeners]) listener(message)
    }
    self.peek = () => cell.peek().latest
    self.chunks = () => windowOf(cell())

    /** The last `tail` of the buffer, as its own array. Built once per version and held on it. */
    function windowOf(held: Received<T>): T[] {
        if (held.view === null) {
            const from = held.buffer.length - tail
            held.view = from > 0 ? held.buffer.slice(from) : held.buffer.slice()
        }
        return held.view
    }
    self.settled = () => cell().got
    self.invalidate = (pattern?: Partial<Args>): void => {
        if (rooms !== null) {
            const wanted = matcher(pattern)
            for (const entry of rooms.values()) if (wanted(entry.args)) entry.room.invalidate()
            // A pattern names ROOMS, so it stops there; a bare `invalidate()` means everything, and
            // the stream the bare `ch()` reads is part of everything.
            if (pattern !== undefined) return
        }
        if (expiry !== null) {
            clearTimeout(expiry)
            expiry = null
        }
        cell.set(EMPTY as Received<T>)
    }
    self.pending = () => cell.pending()
    self.refreshing = () => cell.refreshing()
    self.error = () => cell.error()
    // A stream with no end: it never finishes, so it is never `done`, and it is always producing in
    // the only sense a channel has. Constants, and honest ones — the alternative is a reader having
    // to know which primitive it was handed before it can ask.
    self.streaming = () => true
    self.done = () => false
    self.isError = (error: unknown, name: string) => isNamedError(error, name)
    self.watch = (handler) => watch(self as () => T | undefined, handler)
    self.subscribe = (listener: (message: T) => void): (() => void) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
    }
    // The one protocol both iterating faces have: a queue, a wake latch, and an unsubscribe on the
    // way out. The seed is read INSIDE the body rather than at the call, so it and the `subscribe`
    // land in the same synchronous run — a message published between them would otherwise be missed
    // by the snapshot and dropped by the not-yet-subscriber.
    async function* follow(replay: boolean): AsyncGenerator<T> {
        const pending: T[] = replay ? [...windowOf(cell.peek())] : []
        let wake: (() => void) | null = null
        const off = self.subscribe((message) => {
            pending.push(message)
            wake?.()
            wake = null
        })
        try {
            for (;;) {
                while (pending.length > 0) yield pending.shift() as T
                await new Promise<void>((resolve) => {
                    wake = resolve
                })
            }
        } finally {
            // Reached when the consumer goes away — a cancelled reader calls `return()`, which is what
            // a closed connection is. Without it every abandoned reader stays subscribed for good.
            off()
        }
    }
    self.tail = () => follow(true)
    self[Symbol.asyncIterator] = () => follow(false)
    return self
}
