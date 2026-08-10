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

// One shared empty array, so a `chunks()` reader on a channel with no retention sees the same
// identity every time and never wakes for it.
const NO_MESSAGES: never[] = []

/**
 * How many yielded messages a reader's queue holds before the dead head is spliced off.
 *
 * The same slack `head`/`compact` keep for the transcript: nothing is copied per message, and the
 * one copy is paid once per this many. A reader that keeps up never reaches it at all.
 */
const DRAIN_SLACK = 64

/**
 * How a ROOM lets go of itself, keyed on the room rather than carried as a field on it.
 *
 * A channel's public shape is what a component reads, and a room is an ordinary channel — the whole
 * claim of the room form is that there is no second vocabulary. So the one thing a room knows that a
 * bare channel does not lives out here, where nothing that reads a channel can see it, and where a
 * channel that is not a room carries no entry at all.
 */
const FORGET_ROOM = new WeakMap<object, () => void>()

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
export interface KeyedChannel<Args, T> {
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
export function channel<T, Args>(options?: ChannelOptions): KeyedChannel<Args, T>
export function channel<T, Args>(options: ChannelOptions = {}): Channel<T> & KeyedChannel<Args, T> {
    const tail = options.tail ?? 0
    const maxAge = options.maxAge ?? Infinity
    // Only `schedule`/`expire` ask how old a message is, and nothing reaches them without this. So
    // the clock read and the parallel array are maintained only where they are read: a channel with
    // no `maxAge` — the default — pays neither per publish.
    const ages = maxAge !== Infinity
    const listeners = new Set<(message: T) => void>()

    // --- what is held, and what WAKES for it -------------------------------
    //
    // Three cells rather than one envelope, for the reason `graph.ts` keeps four one-bit nodes
    // instead of a status record: a record rebuilt per publish is never identity-equal to the one
    // before it, so every cutoff downstream stops cutting off and every reader wakes for every
    // message. `settled()` moves once in a channel's life and `chunks()` on a channel with no
    // retention never moves at all — neither can be spelled through a shared envelope.
    //
    // Splitting costs a reader of all three nothing: two writes in one synchronous region mark an
    // effect DIRTY once, and `Node.mark` will not queue it twice.
    /** Bumped by every publish — the signal a bare `ch()` reader subscribes to. */
    const messages = state(0)
    /** Bumped only when the TRANSCRIPT moves, so `tail: 0` never wakes a `chunks()` reader. */
    const transcript = state(0)
    /** Flips once and then holds, so a `settled()` reader wakes once rather than per publish. */
    const got = state(false)

    // The payload the cells above are the signal FOR. Plain fields: nothing subscribes to them, and
    // a reader that woke on a version reads them on the way past.
    let latest: T | undefined
    /** When `latest` arrived. Written and consulted only under `maxAge`. */
    let at = 0
    /**
     * Messages oldest-first, PUSHED into rather than rebuilt per publish. Live from `head` on.
     *
     * Rebuilding the transcript per message cost a copy of the whole retention every time — 1242 ns
     * at `tail: 500` against 8 ns here.
     */
    let buffer: T[] = NO_MESSAGES
    /** Arrival times, parallel to `buffer`. Built and consulted only under `maxAge`. */
    let stamps: number[] = NO_MESSAGES
    /**
     * Where the live window STARTS. Dropping the oldest message is `head++`, never a splice, so the
     * retention size cannot reach the publish: eviction is O(1) and the one O(tail) compaction below
     * is paid once per `tail` messages. This is what `maxAge` used to give up — it ran with no slack
     * so that `stamps[0]` was the oldest surviving message, and paid a memmove per publish for it.
     * A cursor answers the same question without the trade, because `stamps[head]` IS that message.
     */
    let head = 0
    /**
     * The live window as its own array, built on first ask and held until the transcript moves.
     *
     * A COPY, because the buffer keeps being pushed into — so `chunks()` hands back a new array
     * after a publish and the same one between them. A channel nobody reads the transcript of pays
     * for none of them.
     */
    let view: T[] | null = NO_MESSAGES

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
        FORGET_ROOM.set(room, () => {
            // Only if it is still the room under that key: a select that built a new one after the
            // last subscriber left must not be dropped by the old one's departure arriving after it.
            const table = rooms
            if (table !== null && table.get(key)?.room === room) table.delete(key)
        })
        return room
    }

    // A channel is a SOURCE, so a slot reads it rather than rendering it. Without this the two
    // substrates disagreed: the server recurses through any function and printed the message, while
    // the client asks the brand and printed the channel's own source text.
    const self = markSource(((args?: Args) => {
        if (args !== undefined) return roomFor(args)
        // The VERSION is what is subscribed to, and the payload is read on the way past: a publish
        // of the same value twice is two messages, and a reader of `ch()` has to wake for both.
        messages()
        return latest
    }) as Channel<T> & KeyedChannel<Args, T>)

    // --- expiry ------------------------------------------------------------
    //
    // A message goes stale by the passage of time, so something has to WAKE for it: a reader that
    // only found out on its next read would go on showing a message the channel stopped claiming.
    // One timer, armed for the OLDEST surviving message rather than the newest, so a transcript
    // drops its head at the right moment instead of all at once with the tail.

    let expiry: ReturnType<typeof setTimeout> | null = null

    function schedule(): void {
        // A live timer is LEFT alone, and that is safe because the deadline only ever moves forward:
        // it is `stamps[head] + maxAge`, `head` only advances, and `stamps` only grows at the end.
        // So an armed timer can be early but never late — and an early fire drops nothing and
        // re-schedules from its own tail. Re-arming per publish meant a `clearTimeout` and a fresh
        // timer object per message, which on a socket-fed channel is per chunk. `invalidate` clears
        // it explicitly and `expire` nulls it before re-arming, so both still reach the recompute.
        if (expiry !== null) return
        // `stamps[head]`, not `stamps[0]`: the oldest SURVIVING message, which is what the cursor
        // makes cheap to name. Everything before `head` was evicted and is waiting to be compacted.
        const oldest = head < stamps.length ? (stamps[head] as number) : got.peek() ? at : 0
        if (oldest === 0) return
        expiry = arm(expire, Math.max(0, oldest + maxAge - Date.now()))
    }

    function expire(): void {
        expiry = null
        const now = Date.now()
        let dropped = 0
        while (head < stamps.length && now - (stamps[head] as number) >= maxAge) {
            head++
            dropped++
        }
        const staleLatest = got.peek() && now - at >= maxAge
        if (dropped > 0) {
            compact()
            view = null
            transcript.set(transcript.peek() + 1)
        }
        if (staleLatest) {
            latest = undefined
            at = 0
            got.set(false)
            messages.set(messages.peek() + 1)
        }
        schedule()
    }

    /**
     * Move the live window back to index 0, once the evicted head has grown to `tail`.
     *
     * The one O(tail) copy in the design, and it is paid once per `tail` evictions rather than once
     * per publish — which is what keeps a bigger retention from being a dearer one.
     */
    function compact(): void {
        // `tail` is never negative, so `head > tail` already says `head > 0`.
        if (head > tail) {
            buffer.splice(0, head)
            if (ages) stamps.splice(0, head)
            head = 0
        }
    }

    self.publish = (message: T): void => {
        latest = message
        if (ages) at = Date.now()
        if (tail > 0) {
            // The empty transcript is SHARED. The first publish takes one of its own rather than
            // pushing into the constant every channel starts from.
            if (buffer === (NO_MESSAGES as unknown as T[])) {
                buffer = []
                if (ages) stamps = []
            }
            buffer.push(message)
            if (ages) stamps.push(at)
            // Eviction is a cursor step, so the cost of dropping the oldest message does not grow
            // with how many are kept. `compact` is what pays for it, once per `tail` of these.
            if (buffer.length - head > tail) head++
            compact()
            view = null
            transcript.set(transcript.peek() + 1)
        }
        // No retention means the transcript never moved, so `transcript` was not bumped and a
        // `chunks()` reader on this channel does not wake — it would only be handed the same shared
        // empty array it already has.
        got.set(true)
        messages.set(messages.peek() + 1)
        if (ages) schedule()
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
    self.peek = () => latest
    self.chunks = () => {
        transcript()
        return windowOf()
    }

    /** The live window as its own array. Built on the read that follows a move, and held until the next. */
    function windowOf(): T[] {
        if (view === null) view = buffer.slice(head)
        return view
    }
    self.settled = () => got()
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
        // Asked BEFORE the reset, and separately, for the reason the three cells exist at all: a
        // room with nothing in it has no transcript to forget and no message to un-say, so an
        // unguarded bump woke every reader of every idle room on a bulk `invalidate(pattern)` and
        // handed each one back exactly what it already had. `expire` guards the same two writes.
        const hadWindow = buffer.length - head > 0
        const hadMessage = got.peek()
        latest = undefined
        at = 0
        buffer = NO_MESSAGES
        stamps = NO_MESSAGES
        head = 0
        view = NO_MESSAGES
        got.set(false)
        if (hadWindow) transcript.set(transcript.peek() + 1)
        if (hadMessage) messages.set(messages.peek() + 1)
    }
    // All five cold answers spelled as the constants they are. `messages` is only ever handed a
    // number, so routing the first three through it asked a cell that can never load: the first
    // probe built it an `Async` tracker — six nodes, each with its own observer Set — and every read
    // then SUBSCRIBED the calling effect to a node that provably never moves, so a template slot
    // holding `feed.pending()` accumulated a dead subscription per re-run for an answer fixed at
    // construction. A stream with no end is likewise never `done` and always producing, in the only
    // sense a channel has. Constants, and honest ones — the alternative is a reader having to know
    // which primitive it was handed before it can ask.
    self.pending = () => false
    self.refreshing = () => false
    self.error = () => undefined
    self.streaming = () => true
    self.done = () => false
    self.isError = (error: unknown, name: string) => isNamedError(error, name)
    self.watch = (handler) => watch(self as () => T | undefined, handler)
    self.subscribe = (listener: (message: T) => void): (() => void) => {
        listeners.add(listener)
        return () => {
            if (!listeners.delete(listener)) return
            // The LAST subscriber leaving is what forgets a ROOM. Rooms are named by whoever selects
            // one — a socket's comes off the query string of the request that upgraded — so a table
            // that only ever grows is one an arriving connection can grow without a bound, and a
            // room holds a retention and three cells. What goes is exactly what nothing can reach:
            // a room nobody is subscribed to is a transcript nobody will be handed. The bare channel
            // has no owner to be forgotten by and carries no entry here.
            if (listeners.size === 0) FORGET_ROOM.get(self)?.()
        }
    }
    // The one protocol both iterating faces have: a queue, a wake latch, and an unsubscribe on the
    // way out. The seed is read INSIDE the body rather than at the call, so it and the `subscribe`
    // land in the same synchronous run — a message published between them would otherwise be missed
    // by the snapshot and dropped by the not-yet-subscriber.
    async function* follow(replay: boolean): AsyncGenerator<T> {
        const pending: T[] = replay ? buffer.slice(head) : []
        // A CURSOR WITH SLACK — `buffer`/`head`/`compact` one screen up, spelled again for the queue
        // a reader drains. A generator spends its life parked at the `yield` and `subscribe` pushes
        // the whole time it is parked, so `shift` moved what was left of the queue once per message:
        // quadratic on the `replay` drain, and a `tail` raised to remember more made it dearer still.
        // But a bare cursor is worse in the other direction — a producer faster than its consumer
        // never lets the drain catch up, so the reset never runs and the queue retains every message
        // of the session. So the dead head is spliced off once it is worth a memmove, which is the
        // trade `compact` already makes: O(1) per message, one O(k) copy per k messages.
        let sent = 0
        let wake: (() => void) | null = null
        // Built once for the whole loop, not one executor per park: this runs per message.
        const park = (resolve: () => void): void => {
            wake = resolve
        }
        const off = self.subscribe((message) => {
            pending.push(message)
            wake?.()
            wake = null
        })
        try {
            for (;;) {
                while (sent < pending.length) {
                    const message = pending[sent++] as T
                    // Both conditions, and the second is what makes the cost claim true: the splice
                    // copies what is LEFT, so slack alone would copy a long backlog once per 64
                    // messages — O(backlog/64) each, not O(1). Waiting until the dead head is at
                    // least half the queue makes each copy pay for the slots it reclaims, which is
                    // the amortisation `compact` gets for free from `tail` bounding its survivors.
                    if (sent >= DRAIN_SLACK && sent * 2 >= pending.length) {
                        pending.splice(0, sent)
                        sent = 0
                    }
                    yield message
                }
                pending.length = 0
                sent = 0
                await new Promise<void>(park)
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
