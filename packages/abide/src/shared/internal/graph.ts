// The reactive engine: state + memo + watch, dependency tracking, lazy memoised derivations,
// microtask-batched effects, glitch-free via push-CHECK / pull-recompute, and disposal.
//
// Push-CHECK / pull-recompute is what makes this glitch-free without a topological sort: a write
// marks direct dependents DIRTY and everything deeper CHECK, and a CHECK node only recomputes if a
// source really moved. A diamond therefore wakes its sink once, not twice.
//
// A cell holds a SETTLED value whether the data arrived synchronously or not — see "async cells".
//
// This is deliberately ONE file rather than graph / async / cell. `Node.run` decides between "this
// is a value" and "this is a load" inline, and the load path writes back through `Node.write` — so
// any split along those lines is an import cycle, not a seam. `#shared/reactive.ts` is the public
// face of what is here; nothing outside abide imports this module.

import { abideLog } from '../log.ts'
import { markSource } from './BRANDS.ts'
import { chunkCharge, reportOverflow, streamCeiling } from './ceilings.ts'
import { isAsyncIterable, isNamedError, isThenable, messageOf } from './probes.ts'
import { disposeWith, storeFor, storeForLazy } from './scopes.ts'
import { NO_LIMIT } from './timers.ts'

// Annotated `number` rather than left as literal types: `status` is mutated re-entrantly (a source's
// `pull()` can promote this node to DIRTY mid-loop), so literal narrowing would make the compiler
// reject a comparison that is exactly the point of the loop.
const CLEAN: number = 0
const CHECK: number = 1
const DIRTY: number = 2
const DEAD: number = 3

// Where an EFFECT is in its own body, which `status` cannot say: it is DIRTY for the whole of the
// run it is answering, so a mark arriving mid-run is indistinguishable from that one. See `mark`.
const NOT_RUNNING: number = 0
const RUNNING: number = 1
const REMARKED: number = 2

/** The empty every node starts and ends on. Only `run`'s own array is ever pushed into — see below. */
const NO_SOURCES: Node[] = []

/** The same, for the other direction. `read` replaces it before it pushes. */
const NO_OBSERVERS: Node[] = []

let current: Node | null = null

/**
 * A walk that will CALL THE THUNK AGAIN is standing under this read.
 *
 * The other half of "who catches a pending read", and the half `current` cannot describe: the server
 * walk subscribes to nothing, so there is no running node to recognise it by — it recovers by
 * re-calling, not by waking. Set around a synchronous call and never across an await, or a
 * concurrent request's reads see it.
 */
let willRetry = false

/**
 * The signal a read threw that nothing has answered for yet.
 *
 * A JavaScript `catch` is TOTAL: an author's `try` around a read WILL fire, and no throw can be made
 * to skip it. So the signal is not made invisible — it is made not to MATTER. A body that returns
 * while this is set returns output built from a read that never happened, so its boundary throws the
 * signal on its behalf and waits exactly as though the throw had reached it. The `catch` block still
 * runs; what it produced is discarded.
 *
 * Meaningful only INSIDE the body currently running: every boundary saves and restores it around its
 * own call, so a nested one cannot leak a signal outwards or wipe an outer one. A signal that escapes
 * a body does so as a throw, and the catcher that means to keep it travelling re-arms this.
 */
let outstanding: Pending | null = null

/**
 * How far the running node's reads have MATCHED the sources its previous run collected, and the
 * fresh list once one of them has not.
 *
 * A re-run almost always reads the same sources in the same order — `${() => row.id === selected()}`
 * reads one cell, in one order, forever — and the subscription it wants is already the one it has.
 * Detaching from every source and re-collecting them was therefore a remove and an add per source
 * per wake, all of it to arrive back where it started: on a thousand rows reading one cell it was
 * the single largest item in the wake, and `abideclean` — the separate checkout the cross-repo
 * comparison runs against, not anything in this tree — skips it and runs `select row` at 0.40 ms
 * against 1.50.
 *
 * So a matching read only advances `sourceIndex`, and `collected` stays null. The first read that
 * DIVERGES starts a fresh list, and only from that point is anything unsubscribed — the prefix in
 * front of it was right and is left alone.
 */
let sourceIndex = 0
let collected: Node[] | null = null
let queue: Node[] = []
let scheduled = false
let collecting: (() => void)[] | null = null

export class Node {
    value: unknown
    fn: (() => unknown) | null
    status: number
    isEffect: boolean
    // The SHARED empty, never the node's own: it is REPLACED before anything is written into it, so
    // nothing can reach this one. Every `state()`, every cold slot and all six trackers of an `Async`
    // are `fn === null` nodes that never run at all — a keyed memo with 500 settled slots was
    // allocating ~3500 arrays for an iteration that is always empty. Same invariant `NO_CHUNKS` below
    // and `channel`'s `NO_MESSAGES` already rest on.
    sources: Node[] = NO_SOURCES
    /**
     * The nodes that read this one. An ARRAY, and one that may hold the same node twice.
     *
     * The duplicate is the point rather than a tolerated cost: a body reading one source twice
     * records two reads, and `settleSources` gives back exactly as many as the run took. A `Set`
     * cannot — `add` twice is one entry and the first `delete` is total, so a body that reads a
     * source twice and then once unsubscribes itself completely while still reading it, and the
     * effect goes silent for good. Wake counts are the only thing that can see that, which is why
     * the `watch` suite counts it.
     *
     * A shared empty for the same reason `sources` has one: a `state` nothing derives from is the
     * common shape, and it used to allocate a `Set` eagerly — 104 bytes per observing effect and 32
     * per bare cell, measured over 100k of each.
     */
    observers: Node[] = NO_OBSERVERS
    cleanup: (() => void) | null = null
    // A settled value is present. Distinguishes "loaded undefined" from "never loaded", and is what
    // decides cold-pending vs warm-refreshing on the next load.
    hasValue = false
    // Allocated on first contact with a promise or a probe, never before.
    asyncTrack: Async | null = null
    // Every write passes through this before it is stored — `state(initial, transform)` and
    // `memo(fn, transform)`. Null on almost every node, so the cost is one field and one null check.
    transform: ((value: unknown) => unknown) | null = null
    // The last run of this body did not finish, because a read inside it SIGNALLED — so the node is
    // DIRTY with no value behind it. Read by `mark`, and false on every node that has never met a
    // load. See the note there for why the distinction has to exist.
    signalled = false
    /**
     * `NOT_RUNNING` / `RUNNING` / `REMARKED` — an effect's position in its OWN body, and whether a
     * source moved while it was in there. Never leaves `NOT_RUNNING` on a derivation or a state.
     */
    runState = NOT_RUNNING

    constructor(payload: unknown, fn: (() => unknown) | null, isEffect = false) {
        this.fn = fn
        this.isEffect = isEffect
        this.value = payload
        this.status = fn === null ? CLEAN : DIRTY
    }

    read(): unknown {
        if (current !== null) {
            // Still walking the previous run's list, and this is what it says comes next: the
            // subscription that read wants is the one already in place, so there is nothing to
            // unsubscribe and nothing to add. This is the arm nearly every read of every re-run
            // takes — see `sourceIndex`.
            if (collected === null && current.sources[sourceIndex] === this) sourceIndex++
            else if (collected === null) collected = [this]
            else collected.push(this)
        }
        if (this.fn !== null) this.pull()
        return this.value
    }

    write(next: unknown): void {
        if (this.value === next) return
        this.value = next
        // Unobserved is the COMMON shape, not an edge: five of the six `Async` probe nodes below are
        // written on every settle and read by nobody, a channel's transcript has no observer until
        // something calls `chunks()`, and a `state` nothing derived from has none ever. `for…of` over
        // an empty Set still allocates its iterator here — JSC sinks it at some sites and not at
        // these — so the guard is 1.000 fewer Set Iterators per write, and 2.7x on an unobserved
        // `state.set`. The observed arm measured within noise, so the branch costs nothing to keep.
        const observers = this.observers
        if (observers.length === 0) return
        // Indexed, and safe to index: `mark` queues and sets status, it never runs a body, so
        // nothing under this loop can add or remove an edge in the array being walked.
        for (let i = 0; i < observers.length; i++) (observers[i] as Node).mark(DIRTY)
    }

    mark(next: number): void {
        // A source moved while this effect's own body was RUNNING, so the run underway answered the
        // value that source had before the move: an `{#if}` reading `pending()` false and then, on
        // its else arm, kicking the load that flips it true. It is DIRTY for the whole of that run,
        // so absorbing this as "the mark the run is already answering" is what lost the flip;
        // `finishRun` re-marks it instead. Only a `mark` counts — a derivation recomputed by a read
        // INSIDE the run writes its observers' status directly, and THAT one is consumed in place,
        // by the very read that pulled it. Effects have no observers, so nothing travels past here.
        if (this.runState !== NOT_RUNNING) {
            // …unless this run is the one that CAUSED the move, through a probe that kicks: the
            // flip is written inside `pending()` and reported by the same call, so the run is
            // answering from AFTER it, not before. That is the "consumed in place" exemption the
            // paragraph above draws for a derivation pulled by a read, and it is the same shape —
            // absorbing here is only wrong when the run answered first and the move came second.
            if (this !== kickedBy) this.runState = REMARKED
            return
        }
        if (this.status >= next) {
            // Already at least this dirty, so there is nothing to raise — but a node left DIRTY by a
            // SIGNAL has produced no value and told its observers nothing, and absorbing the mark
            // here is what made it serve a stale one for good. `relayed` subscribes the READER to the
            // flip that ends the load, which covers the load it was armed for and no other: when the
            // body goes on to read a DIFFERENT cell — a keyed slot whose args moved is the ordinary
            // way — that first flip never fires again and the change stops here.
            //
            // So the status stays DIRTY, which is what keeps the next read running the body, and the
            // mark still travels. Every other mark takes the return above, which is the arm the
            // propagation cost is paid on.
            if (!this.signalled) return
            const observers = this.observers
            for (let i = 0; i < observers.length; i++) (observers[i] as Node).mark(CHECK)
            return
        }
        if (this.status === CLEAN && this.isEffect) {
            queue.push(this)
            if (!scheduled) {
                scheduled = true
                queueMicrotask(flush)
            }
        }
        this.status = next
        const observers = this.observers
        if (observers.length === 0) return
        for (let i = 0; i < observers.length; i++) (observers[i] as Node).mark(CHECK)
    }

    pull(): void {
        if (this.status === CLEAN || this.status === DEAD) return
        if (this.status === CHECK) {
            for (const source of this.sources) {
                source.pull()
                if (this.status === DIRTY) break
            }
        }
        if (this.status === DIRTY) {
            // A DERIVATION whose body throws synchronously has FAILED TO SETTLE — the same outcome a
            // keyed memo gives it (`memo.ts`'s `start` catches and calls `internals.fail`) — not a
            // node left DIRTY. Left DIRTY, `mark` early-returns on `status >= next` forever, so
            // nothing downstream ever wakes again even after the data recovers, and the memoisation
            // is gone with it: every read re-runs the body and re-collects its sources. `readCell`
            // still throws, now from the retained error rather than from the body.
            //
            // An EFFECT keeps throwing out of here: `flush` resets it to CLEAN and rethrows from a
            // fresh microtask, which is what keeps the throw observable.
            if (this.isEffect) {
                rerun(this)
                return
            }
            // Cleared BEFORE the run and set only by the signal below, so any run that reaches a
            // value clears it — including the one this pull is about to make.
            this.signalled = false
            try {
                this.run()
            } catch (error) {
                if (error instanceof Pending) {
                    // The node is DIRTY with nothing behind it, and `mark` has to know: it would
                    // otherwise absorb every later change to this body's own sources.
                    this.signalled = true
                    // Nobody to signal: whoever read this derivation is at a position that will
                    // not run again, so it serves what it has — nothing yet — exactly as the cold
                    // cell under it would have. Returning here leaves the node DIRTY, so the next
                    // read runs the body rather than trusting a value it never produced.
                    if (current === null && !willRetry) return
                    // Re-armed for whoever is reading: the derivation's own run restored this on
                    // its way out, so without it a body that CATCHES the relayed signal would
                    // look like a body that never met one.
                    outstanding = error
                    throw relayed(error)
                }
                settleError(this, error)
            }
        }
        this.status = CLEAN
    }

    /** Give back one edge. Linear, and that is affordable BECAUSE `read` makes it rare — see below. */
    private unsubscribeFrom(index: number): void {
        const sources = this.sources
        for (let i = index; i < sources.length; i++) {
            const observers = (sources[i] as Node).observers
            // One occurrence per read, so one removal per read: a source this node read twice is in
            // here twice, and a run that now reads it once has to give back exactly one of them.
            const at = observers.indexOf(this)
            if (at === -1) continue
            const last = observers.length - 1
            if (at !== last) observers[at] = observers[last] as Node
            observers.pop()
        }
    }

    /**
     * Make the subscriptions match what the run just read.
     *
     * Three outcomes, and the first is the one that matters: every read matched, so `collected` is
     * null and `sourceIndex` reached the end — nothing is unsubscribed, nothing is added, and the
     * run cost the graph nothing at all.
     */
    private settleSources(): void {
        if (collected !== null) {
            // A read diverged at `sourceIndex`. The prefix in front of it was right; everything from
            // there on is not read any more and the fresh tail replaces it.
            this.unsubscribeFrom(sourceIndex)
            if (sourceIndex > 0) {
                const sources = this.sources
                sources.length = sourceIndex + collected.length
                for (let i = 0; i < collected.length; i++) {
                    sources[sourceIndex + i] = collected[i] as Node
                }
            } else {
                // Never the shared empty: `collected` is this run's own array.
                this.sources = collected
            }
            const sources = this.sources
            for (let i = sourceIndex; i < sources.length; i++) {
                const source = sources[i] as Node
                if (source.observers === NO_OBSERVERS) source.observers = [this]
                else source.observers.push(this)
            }
        } else if (sourceIndex < this.sources.length) {
            // Every read matched, but there were FEWER of them: the tail is no longer read.
            this.unsubscribeFrom(sourceIndex)
            this.sources.length = sourceIndex
        }
    }

    /**
     * Leave the body: CLEAN, unless something moved under the run — in which case it is marked NOW,
     * from outside the run, so the ordinary queueing applies and the effect runs again in this flush.
     */
    finishRun(): void {
        const moved = this.runState === REMARKED
        this.runState = NOT_RUNNING
        // An effect that disposed itself from inside its own body stays DEAD: re-marking it here
        // would queue a node whose teardown has already run.
        if (this.status === DEAD) return
        this.status = CLEAN
        if (moved) this.mark(DIRTY)
    }

    run(): void {
        if (this.cleanup !== null) {
            const teardown = this.cleanup
            this.cleanup = null
            // A teardown must not subscribe the effect to whatever it touches.
            untrack(teardown)
        }

        const previous = current
        const previousIndex = sourceIndex
        const previousCollected = collected
        const previousOutstanding = outstanding
        current = this
        sourceIndex = 0
        collected = null
        outstanding = null
        const before = this.value
        let next: unknown
        try {
            next = this.fn!()
            // Returned normally, but a read inside it did NOT — see `outstanding`. Thrown from
            // inside the `try` on purpose, so the `finally` below still settles the subscriptions the
            // run collected: those are what wake it when the load lands.
            if (outstanding !== null) throw outstanding
        } finally {
            // BEFORE the restore, while these two still describe THIS run — and in a `finally`,
            // because a body that throws has still read whatever it read before it did. Leaving the
            // subscriptions half-settled would keep the node attached to sources the next run never
            // reaches, which is a wake for something it no longer reads.
            this.settleSources()
            current = previous
            sourceIndex = previousIndex
            collected = previousCollected
            outstanding = previousOutstanding
        }

        if (this.isEffect) {
            this.cleanup = typeof next === 'function' ? (next as () => void) : null
            return
        }
        // An async iterable is a STREAM: the value is the latest chunk. Asked FIRST — see
        // `isAsyncIterable` — because a cell answers both and only this arm keeps its transcript.
        if (isAsyncIterable(next)) {
            consume(this, next)
            return
        }
        // …and a promise is a LOAD, not a value: keep serving what is retained and write the node
        // when it lands. Deps read before the body's first `await` are already tracked by the run
        // above, so a re-run re-adopts and the stale settle is discarded by generation.
        if (isThenable(next)) {
            adopt(this, next)
            return
        }
        // A body that went back to a sync value clears whatever the async side was reporting.
        if (this.asyncTrack !== null) {
            this.asyncTrack.generation++
            settleValue(this, next)
            return
        }
        if (this.transform !== null) {
            next = transformValue(this, next)
            // The transform is async: the body settled, the transform did not. `memo(deps, async fn)`
            // lands here, which is the whole of the declared-dependency form's async arm.
            if (next === ADOPTED) return
        }
        // Memoise: only wake observers when the derived value actually moved.
        if (before !== next) {
            const observers = this.observers
            for (let i = 0; i < observers.length; i++) (observers[i] as Node).status = DIRTY
        }
        this.value = next
        this.hasValue = true
    }

    dispose(): void {
        if (this.status === DEAD) return
        // A settle after disposal is dropped, so an in-flight load has to be ENDED here rather than
        // left looking in-flight: anyone already awaiting it is told, and a later `await` on the dead
        // cell resolves with whatever was retained instead of parking a waiter nothing will ever wake.
        const track = this.asyncTrack
        if (track !== null) {
            track.generation++
            standDown(track)
            if (track.waiters !== null) {
                finish(track, new Error('abide: disposed before the load settled'), true)
            }
        }
        if (this.cleanup !== null) {
            const teardown = this.cleanup
            this.cleanup = null
            untrack(teardown)
        }
        this.unsubscribeFrom(0)
        this.sources = NO_SOURCES
        // Whoever was reading this has to ASK AGAIN, because the answer is no longer here. An argless
        // `memo` is a facade over one instance PER CALLER — see `scopedArgless` — so a read taken
        // while somebody else's scope is installed binds the reader to that caller's instance, and
        // the caller then takes it away. Dropping the observers silently left the reader holding a
        // DEAD node, which `mark` can never wake: on `/tests` a page-level memo stopped propagating
        // for good the moment the `scope` suite held an async `isolate` open across one flush, and
        // every derived thing on the page froze while the cells under it went on moving.
        //
        // Marked BEFORE the list is dropped, and free for the node nobody read — the common case is
        // an empty `observers`. A reader being torn down in the same teardown absorbs this in `mark`,
        // which returns early on a status already at DEAD.
        wakeReaders(this)
        // A fresh empty rather than `length = 0`: this may be the SHARED one, which a node that
        // nothing ever read still holds.
        this.observers = NO_OBSERVERS
        this.status = DEAD
    }
}

// Per-node isolation is load-bearing, not defensive coding. Without the try/catch a single throwing
// effect abandons the rest of the batch permanently (every later effect in `batch` never runs), and
// the thrower itself stays DIRTY forever, so it is dead for the life of the page. Resetting to CLEAN
// and rethrowing from a fresh microtask keeps the throw observable without taking the flush down.
function flush(): void {
    scheduled = false
    while (queue.length > 0) {
        const batch = queue
        queue = []
        for (const node of batch) {
            if (node.status === DEAD) continue
            try {
                node.pull()
            } catch (error) {
                node.status = CLEAN
                queueMicrotask(() => {
                    throw error
                })
            }
        }
    }
}

// The transcript a cell that has never streamed hands back. One shared array, so a reader of
// `chunks()` on an ordinary cell sees the same identity every time and never wakes for it.
const NO_CHUNKS: unknown[] = []

/**
 * Forget the transcript: a new run is a new one, not a continuation of the last.
 *
 * Silent when there was nothing to forget — the version only moves when a reader would see a
 * different array, so re-streaming a cell whose transcript was already empty wakes nobody.
 */
function resetChunks(track: Async): void {
    if (track.buffer.length === 0) return
    track.buffer = []
    track.chunks.write((track.chunks.value as number) + 1)
}

/**
 * The same forget, for a run that is about to PUSH: it ends owning a writable buffer of its own.
 *
 * `NO_CHUNKS` is SHARED, so the empty case still has to swap. Readers ARE handed the new array, but
 * both are empty and the version does not move, so a cursor finds the same nothing it found before.
 * `resetNode` keeps calling `resetChunks` instead — un-settling deliberately allocates nothing.
 */
function freshBuffer(track: Async): void {
    resetChunks(track)
    if (track.buffer === NO_CHUNKS) track.buffer = []
}

/**
 * Put a value through the node's `transform` before it is stored, reading nothing under tracking —
 * a transform is UNTRACKED by definition, and `set` is routinely called from inside an effect.
 *
 * Applied at exactly the six places a value becomes the node's own, split by whether the result is
 * the node's VALUE or one CHUNK of a stream. The four value sites — `state`'s initial, a sync write
 * on a cell with no tracker, a settle, and a derivation's sync result — go through `transformValue`
 * below, which adds the one law they share and the chunks do not. The other two call this directly:
 * each chunk a live stream keeps, and each chunk `adoptTranscript` replays from a SEEDED one — a
 * chunk lands through `hold` rather than through a settle, so it is its own site, and a replay is its
 * own again because the stream it carries already happened. `resetNode` deliberately is NOT one of them — dropping to
 * `undefined` is un-settling, not a write, and a clamp that turned it back into a number would make
 * `invalidate` unable to go cold.
 */
function transformed(node: Node, value: unknown): unknown {
    // A non-null `transform` is the caller's precondition. Each of the six tests it before calling,
    // which is what keeps a cell WITHOUT one from paying a call at all — so re-testing here would be
    // a second guard on every settle, every chunk and every sync write of the cells that do have one.
    return untrackCall(node.transform as (value: unknown) => unknown, value)
}

/** `transformValue` started a load of its own — the caller is DONE, and the settle writes the node. */
const ADOPTED = Symbol('abide.adopted')

/**
 * The transform at the four sites where its result becomes the node's VALUE, and the law that a
 * promise it hands back is a LOAD rather than a value — the same rule the body follows, one stage
 * along. Written once here rather than at each of the three, which is also where it went missing:
 * `memo(deps, async fn)` stored the `Promise` itself, so the read handed one back with `pending()`
 * false and `await` on the cell resolved to a promise. A cell holding a promise as a value is the one
 * shape "a promise is a load" has nowhere else.
 *
 * The adoption does NOT re-apply the transform — it has already run — which is the same trap
 * `consume` names when it declines to route its last chunk back through `settleValue`.
 *
 * The other two sites are the STREAM ones and stay on `transformed`: a chunk is ordered, so `consume`
 * awaits it in the loop instead of adopting it, and `adoptTranscript` replays a stream that already
 * happened. A transcript cannot meet an async transform anyway — `Transcript` is off the public
 * surface and the one thing that builds one (`transport.ts`) passes no transform.
 */
function transformValue(node: Node, value: unknown): unknown {
    const next = transformed(node, value)
    if (!isThenable(next)) return next
    adopt(node, next, false)
    return ADOPTED
}

// --- async cells ----------------------------------------------------------
//
// Handing a cell a promise — `state(fetchUser())`, `x.set(p)`, or an argless `memo` body that
// returns one — starts a LOAD instead of storing the promise. The read stays the same call it always
// was and serves the retained value (`undefined` if nothing is retained yet); the node is written
// once the promise lands. That is the whole of "sync or async, same read".
//
// The bookkeeping below is allocated on first contact with a promise or a probe, never before, so a
// cell that only ever holds sync values still costs exactly one Node.

// Four one-bit nodes rather than one status record, for the same reason `memo`'s slot keeps
// `refreshing` separate: each probe must wake only on ITS OWN transition. A status record makes
// `pending()` wake on a warm refresh it reports `false` for, and the identity check on a rebuilt
// record never holds, so every settle would wake every reader.
class Async {
    readonly pending = new Node(false, null) // cold — a load in flight with nothing to show
    readonly refreshing = new Node(false, null) // warm — a load in flight OVER a retained value
    readonly settled: Node
    /**
     * How many times the transcript CHANGED — not the transcript itself.
     *
     * A reader of `chunks()` subscribes to this, which is what lets the buffer below be pushed into
     * rather than rebuilt. Rebuilding it per chunk made the array's identity the wake signal, and
     * paid a copy of the whole transcript for it: `concat` per chunk is O(n²) over a stream, and at
     * 64k chunks that was 98% of the cost of streaming at all.
     */
    readonly chunks = new Node(0, null)
    /** Chunks produced so far, in order. The shared empty array until a stream actually runs. */
    buffer: unknown[] = NO_CHUNKS
    /** A stream is running: chunks are still arriving. Its own signal, like `refreshing`. */
    readonly streaming = new Node(false, null)
    /**
     * The failure, and the ONLY record of one: `undefined` here IS "not failed". That is what
     * `REJECTED_WITH_UNDEFINED` buys — a rejection can never write `undefined` — and it is why there
     * is no second `failed` flag for the four settle paths to keep in step with.
     */
    readonly error = new Node(undefined, null)
    // A later write must win even when an earlier promise settles after it. Without the stamp a slow
    // first load lands on top of the fast second one and the cell reports the value nobody asked for.
    generation = 0
    /**
     * Who is waiting, and WHICH moment each of them asked for.
     *
     * `atFirstChunk` is the difference between "there is something to show" and "the load is over",
     * and those are the same moment for everything but a STREAM: `pending` stands down at the first
     * chunk while the settle waits for the last. One list rather than two, so the four paths that
     * end a load — settle, failure, invalidate, dispose — go on draining every waiter through
     * `finish` and there is no second list for them to keep in step with.
     */
    waiters:
        | { resolve(value: unknown): void; reject(reason: unknown): void; atFirstChunk: boolean }[]
        | null = null
    /**
     * The failure already written to `abide:load`, so a re-render does not say it again.
     *
     * The REASON rather than a flag: a retry against a source that is still down throws a new `Error`
     * per attempt, and each of those is a new failure worth a line. The same object arriving twice is
     * one event, which is the rule `settleError` already applies to the wake.
     */
    reported: unknown = undefined

    constructor(settled: boolean) {
        this.settled = new Node(settled, null)
    }
}

function trackerFor(node: Node): Async {
    let track = node.asyncTrack
    if (track === null) {
        track = new Async(node.hasValue)
        node.asyncTrack = track
    }
    return track
}

/**
 * Which probe a starting load moves. Both starters ask it, so the cold/warm rule has one writer.
 *
 * COLD (nothing retained) → `pending`, because there is genuinely nothing to show. WARM (a value is
 * held) → only `refreshing` moves, so the retained value keeps being served and its readers stay
 * asleep until the load actually changes it.
 *
 * A retained `undefined` counts as COLD: `state(undefined)` has settled, but it has nothing to keep
 * showing, and a spinner that reads `refreshing` over a blank cell is the wrong spinner.
 */
function markStarted(node: Node, track: Async): void {
    if (node.hasValue && node.value !== undefined) track.refreshing.write(true)
    else track.pending.write(true)
}

// `applyTransform` is false for exactly one caller: `transformValue`, whose promise IS the
// transform's own result. Running it again on the way in would put the value through twice.
function adopt(node: Node, promise: PromiseLike<unknown>, applyTransform = true): void {
    const track = trackerFor(node)
    const generation = ++track.generation
    markStarted(node, track)

    // `Promise.resolve` of a native promise is that same promise, so the common case adds no tick;
    // it is here to make a foreign thenable safe to adopt.
    Promise.resolve(promise).then(
        (value) => {
            if (generation === track.generation) settleValue(node, value, applyTransform)
        },
        (error: unknown) => {
            if (generation === track.generation) settleError(node, error)
        },
    )
}

// Everyone reading this node has to ASK AGAIN, without the node's own value having moved. A FAILURE
// is the case that needs it most: it changes the OUTCOME of a plain read while the value stays put,
// and subscribing those readers to the error node instead does not work — a reader that ran before
// the cell ever met a promise subscribed when there was no error node to subscribe TO, and would
// then sit on the last good value as though the load had succeeded. Disposal wants the same wake for
// a different reason; `Node.write` keeps its own copy, being the per-write path.
function wakeReaders(node: Node): void {
    const observers = node.observers
    for (let i = 0; i < observers.length; i++) (observers[i] as Node).mark(DIRTY)
}

function settleValue(node: Node, value: unknown, applyTransform = true): void {
    if (node.status === DEAD) return
    const track = trackerFor(node)
    if (applyTransform && node.transform !== null) {
        // A transform that throws is a failed settle, not a throw out of a promise callback nobody
        // is standing under — the cell reports it exactly as a rejected load.
        try {
            value = transformValue(node, value)
        } catch (error) {
            settleError(node, error)
            return
        }
        // It handed back a promise instead: still loading, so nothing settles here.
        if (value === ADOPTED) return
    }
    hold(node, track, value)
    markSettled(track)
    finish(track, value, false)
}

/**
 * Drop a held failure, and the note saying it was already reported.
 *
 * One function because the two have to move together: `reported` is the identity `reportFailure`
 * dedupes against, so a clear that forgets it both retains a discarded `Error` for the cell's lifetime
 * and goes silent if the same object is thrown again after a recovery.
 */
function clearError(track: Async): void {
    track.error.write(undefined)
    track.reported = undefined
}

/** Store a value the load produced, and stop the read throwing if the last one failed. */
function hold(node: Node, track: Async, value: unknown): void {
    const recovered = track.error.value !== undefined
    node.hasValue = true
    node.write(value) // identity-deduped: a re-fill of unchanged data wakes nobody
    if (recovered) {
        clearError(track)
        wakeReaders(node) // …the value did not move, but the OUTCOME of reading it did
    }
}

/**
 * A stream that ALREADY HAPPENED — the whole transcript at once, settled in the call.
 *
 * `consume` is a `for await` and costs a tick per chunk however the chunks arrive, so replaying a
 * seeded transcript through it would leave the cell `streaming` for as many microtasks as there are
 * chunks. A hydrating region reading it in that window sees a partial transcript and rebuilds its
 * rows against markup already holding all of them — which is the whole thing seeding a stream is for.
 *
 * The version moves ONCE and the value is written ONCE, from the last chunk. Pushing through `hold`
 * per chunk would wake every reader n times for a transcript that was complete before any of them
 * looked.
 */
function adoptTranscript(node: Node, chunks: readonly unknown[]): void {
    const track = trackerFor(node)
    track.generation++ // whatever was in flight is no longer wanted
    freshBuffer(track)
    for (let i = 0; i < chunks.length; i++) {
        track.buffer.push(node.transform === null ? chunks[i] : transformed(node, chunks[i]))
    }
    track.chunks.write((track.chunks.value as number) + 1)
    if (chunks.length > 0) hold(node, track, track.buffer[track.buffer.length - 1])
    markSettled(track)
    finish(track, node.value, false)
}

/**
 * Nothing is in flight any more, whatever ended it.
 *
 * One writer for the three probes, because they stand down TOGETHER: `markSettled` used to leave
 * `streaming` alone, so each of its stream callers wrote that line itself and a settle reached any
 * other way left a cell claiming to stream. Every write here is identity-deduped, so a probe already
 * false costs one compare.
 */
function standDown(track: Async): void {
    track.pending.write(false)
    track.refreshing.write(false)
    track.streaming.write(false)
}

/** Nothing is in flight any more, and it ended without a failure. */
function markSettled(track: Async): void {
    clearError(track)
    standDown(track)
    track.settled.write(true)
}

// --- streams --------------------------------------------------------------
//
// An async iterable handed to a cell is a STREAM, the same way a promise handed to one is a load:
// the cell holds the LATEST chunk, `chunks()` holds the transcript, and the read is the ordinary
// call throughout. The probes compose rather than needing a vocabulary of their own — cold until the
// first chunk (`pending`), then a load in flight over a value that is already being served
// (`refreshing`), `streaming` all the way through, and `settled` + `done` when it ends cleanly.
//
// The transcript is PUSHED into and a version counter is what wakes a reader — see `Async.chunks`.
// `chunks()` hands back that buffer itself, not a copy of it, so the version is the ONLY wake signal
// and the array's identity moves only when the transcript is replaced (a reset, or an overflow drop).
// `iterate`'s cursor below reads it that way: a changed identity means start over, not one more chunk.
function consume(node: Node, source: AsyncIterable<unknown>): void {
    const track = trackerFor(node)
    const generation = ++track.generation
    markStarted(node, track)
    track.streaming.write(true)
    freshBuffer(track)

    // The transcript's ceiling, declared ONCE per stream — the cap is per-stream, so no chunk reads
    // an environment and a stream nobody capped charges nothing at all.
    const ceiling = streamCeiling()
    let charged = 0
    let keeping = true
    let showed = false

    void (async () => {
        try {
            for await (const raw of source) {
                // A newer load, a `set`, an `invalidate` or a disposal all bump the generation, and
                // any of them means nobody wants the rest of this stream.
                if (generation !== track.generation) return
                let chunk = node.transform === null ? raw : transformed(node, raw)
                // An async transform is a LOAD on the value path; here it is an ordered await
                // instead, because chunk n must land before n+1 is pulled and `adopt` would race
                // them. Guarded, so a sync transform — every one of them today — costs no tick.
                if (isThenable(chunk)) {
                    chunk = await chunk
                    if (generation !== track.generation) return
                }
                if (keeping) {
                    if (ceiling !== NO_LIMIT) charged += chunkCharge(chunk)
                    if (charged > ceiling) {
                        // DROPPED, not trimmed. What overflowed is a REPLAY, and a replay missing
                        // its middle is a transcript with a hole no reader can see — where an empty
                        // one says plainly that there is nothing to replay. The version moves once
                        // for the drop and never again, so a reader wakes for it and then sleeps.
                        keeping = false
                        track.buffer = []
                        reportOverflow(charged, ceiling)
                    } else {
                        track.buffer.push(chunk)
                    }
                    track.chunks.write((track.chunks.value as number) + 1)
                }
                // Outside the guard: the cap is on what is REMEMBERED. The cell still holds the
                // latest chunk and its readers still wake — an overflow disables replay, not the
                // stream.
                hold(node, track, chunk)
                // There is something to show now, so the blank-slate signal stands down and the
                // in-flight one takes over — the same pair a warm reload reports.
                track.pending.write(false)
                track.refreshing.write(true)
                // And a region that PROBED was asking exactly that question, so this is its answer
                // rather than the end of the stream — see `probedLoad`.
                if (!showed) {
                    showed = true
                    showFirstChunk(track, chunk)
                }
            }
        } catch (error) {
            if (generation !== track.generation) return
            settleError(node, error)
            return
        }
        if (generation !== track.generation) return
        // The last chunk is already held and already transformed, so ending is bookkeeping alone —
        // routing it back through `settleValue` would put the value through the transform twice.
        markSettled(track)
        finish(track, node.value, false)
    })()
}

// A failed load makes the READ throw — a caller that ignores it is not handling it. The retained
// value is not destroyed, though: `peek()` still serves it, which is the escape hatch for a UI that
// wants to keep showing stale data next to the error.
//
// A rejection reason of `undefined` is indistinguishable from "no error" in the error node's
// identity check, so it would settle without waking anyone. A marker keeps the wake honest.
const REJECTED_WITH_UNDEFINED = new Error('abide: the load rejected with undefined')

/** Where a read that touched a failed load says so. Why, and why from a read, is on `reportFailure`. */
const loadLog = abideLog.channel('load')

/**
 * Say it once per distinct reason, however many times the read is made.
 *
 * A template arm is re-evaluated on every wake, and a failed cell goes on being failed — so the read
 * is the right place to NOTICE and the wrong place to be unconditional. The reason itself is passed to
 * the console beside the line: `String(err)` is `name: message`, and a stack survives only as the object.
 *
 * Reporting is not redundant with the read throwing. The throw is what a reader sees; it fires only
 * where somebody reads the VALUE, and the arm that reports a failure in markup — `{:else if x.error()}`
 * — is precisely the one that stops reading it. So a page that handles its failures correctly used to
 * be the page with no stack anywhere, and a chain whose arms read neither the value nor `error()` was
 * silent while rendering as though the load had succeeded.
 *
 * The reason goes to the console as an OBJECT, so what DevTools expands is the stack the error was
 * constructed with rather than this line's own call site.
 *
 * An AWAIT is not a read, so nothing here has to check for one. A waiter is rejected through
 * `settledPromise`, which never calls `readCell` — so the guard falls out of where the report is made
 * rather than being a condition on it. That is what keeps a modelled failure quiet: an
 * `error.typed('NoUser', 404)` answered over rpc is an ANSWER, reported on `abide:rpc` with its
 * outcome, and whoever awaited it either catches it or raises an unhandled rejection already carrying
 * the stack. A second ungated stack for it is the loudest possible way to say nothing.
 *
 * Reported from the READ, not from the settle, and that is the load-bearing part. Two earlier
 * placements were built and reverted by the gate. Reporting at the SETTLE cannot tell a broken load
 * from an answer an app DECLARED — an rpc handler returning `error.typed('NoUser', 404)` settles a
 * cell exactly as a dead socket does, so it dumped a stack for every modelled failure a server
 * answered, already reported with its outcome on `abide:rpc`. Moving it behind an `abide/ui` install
 * fixed that and broke the case it was for: a rung whose `<script module>` runs on the SERVER renders
 * its failure arm there and never ships to the browser at all, so the browser lane had nothing to see.
 *
 * A READ is what both of those get right, because reading is what a template does. So
 * `{:else if x.error()}` reports, an arm that reads the value and throws reports, and a handler's
 * declared answer stays the rpc channel's business. It lands in BOTH lanes, which is what the
 * server-rendered rung needs.
 *
 * The two entries are `readCell` and `read.error` — the value and the probe — and abide's own machinery
 * uses BOTH of them, which is why suppression is a scope (`withoutReporting`, `quietly`) rather than a
 * property of the entry. The exceptions are listed on `reporting`; keep them enumerated from the call
 * sites, because a missed one is a stack nobody asked for and nothing goes red.
 */
function reportFailure(track: Async, reason: unknown): void {
    // `!kicking` is `internals.quietly`, and it counts as abide reading on its own behalf for the reason
    // that function's own doc gives: a non-kicking probe is machinery "routing or inspecting rather than
    // displaying". `repl`'s `show()` is the one that proves it — it asks three probes quietly to choose
    // how to PRINT a cell, and a stack dumped into the prompt it is drawing is not a report anybody asked
    // for. Covering it here rather than at that call site is what keeps the next such caller right too.
    if (!reporting || !kicking || track.reported === reason) return
    track.reported = reason
    loadLog.error(`a load failed: ${messageOf(reason)}`, reason)
}

function settleError(node: Node, error: unknown): void {
    if (node.status === DEAD) return
    const track = trackerFor(node)
    const reason = error === undefined ? REJECTED_WITH_UNDEFINED : error
    // A second failure with the very same reason changes nothing a reader can observe — which means
    // the same OBJECT, so in practice this holds for `REJECTED_WITH_UNDEFINED` and for a reason an
    // app hoisted, and not for the `new Error(...)` per attempt that most bodies throw. Deliberately
    // not a structural compare: the read THROWS the reason, so a reader can see the message, and
    // whether two failures carrying the same text are one event or two is the app's call rather than
    // the graph's. What that costs is a wake per retry against a source that is still down.
    const changed = track.error.value !== reason
    track.error.write(reason)
    if (changed) wakeReaders(node)
    standDown(track)
    track.settled.write(true)
    finish(track, error, true)
}

function finish(track: Async, value: unknown, failed: boolean): void {
    const waiters = track.waiters
    if (waiters === null) return
    track.waiters = null
    for (const waiter of waiters) {
        if (failed) waiter.reject(value)
        else waiter.resolve(value)
    }
}

/**
 * The first chunk of a stream: tell whoever asked for something to SHOW, and leave the rest waiting.
 *
 * Called once per stream rather than per chunk — after this the list holds waiters on the settle
 * alone, and walking it again for every chunk would be a cost per chunk for a question already
 * answered.
 */
function showFirstChunk(track: Async, value: unknown): void {
    const waiters = track.waiters
    if (waiters === null) return
    let waiting: typeof waiters | null = null
    for (const waiter of waiters) {
        if (waiter.atFirstChunk) {
            waiter.resolve(value)
            continue
        }
        if (waiting === null) waiting = []
        waiting.push(waiter)
    }
    track.waiters = waiting
}

// --- a read that is not ready yet -------------------------------------------
//
// A COLD load has nothing to serve, and `undefined` is the wrong answer to give for it: it makes
// every caller narrow a value that is only absent for as long as the load takes. So the read SIGNALS
// instead — it throws, whoever is standing under it produces no output for that region, and they run
// again when the graph wakes them.
//
// It signals only where RE-RUNNING is the recovery, which is exactly the two catchers below: a
// running effect or derivation (`current`), and a walk that says it will call the thunk again
// (`willRetry`). Anywhere else — `<script>` setup, an event handler, module scope — the read hands
// back what is there, because nobody would run it a second time.

/** The signal itself, carrying the CELL that was not ready — the one thing a catcher can wait for. */
export class Pending {
    constructor(readonly node: Node) {}
}

export function isPending(error: unknown): error is Pending {
    return error instanceof Pending
}

/** The load the signalling read was waiting on. Rejects exactly as that read will throw. */
export function settledOf(pending: Pending): Promise<unknown> {
    return settledPromise(pending.node)
}

/** Shared, so claiming a discarded promise allocates no closure per call. */
function ignore(): void {}

/** `retryableCall` for a caller that already holds a thunk. */
export function retryable<T>(fn: () => T): T {
    return retryableCall(callThunk, fn)
}

function callThunk<T>(fn: () => T): T {
    return fn()
}

function pullNode(node: Node): void {
    node.pull()
}

/** The same pull, for a caller that will ask again — see `kicker`. Threaded, so it captures nothing. */
function pullRetryably(node: Node): void {
    retryableCall(pullNode, node)
}

/**
 * Call `fn(arg)` with a pending read allowed to signal, for a caller that will call it AGAIN once
 * the load lands. Synchronous by contract — see `willRetry`.
 *
 * The argument is threaded rather than captured for the same reason `untrackCall` exists beside
 * `untrack`: an attribute slot is unwrapped once per attribute per ROW, and the captured form
 * allocates a closure per one of them to make a call the engine can make directly.
 */
export function retryableCall<A, T>(fn: (arg: A) => T, arg: A): T {
    const previous = willRetry
    const previousOutstanding = outstanding
    willRetry = true
    outstanding = null
    try {
        const produced = fn(arg)
        if (outstanding !== null) {
            // An ASYNC body hands back a promise even when a read inside it signalled: the throw
            // becomes a rejection, so nothing arrives here to catch and `outstanding` is the only
            // record of it. The caller acts on the signal and calls `fn` AGAIN, which discards this
            // value — and a discarded promise rejecting with the same signal is an unhandled
            // rejection nobody wrote. Claimed here rather than at the call sites, because this is the
            // line that drops it. The retry is what produces the answer; this only stops the litter.
            if (isThenable(produced)) produced.then(ignore, ignore)
            throw outstanding // something caught the signal — see `outstanding`
        }
        return produced
    } finally {
        willRetry = previous
        outstanding = previousOutstanding
    }
}

/**
 * Did a read in the body currently running signal, and get caught on the way out?
 *
 * For a caller that PRODUCES a value and then acts on it in one body, where `run`'s own check comes
 * too late — a slot binder has already written to the DOM by then. `run` still throws afterwards; this
 * is only what stops the write. No bracket, because `run` already zeroed this at the top of the body.
 */
export function swallowed(): boolean {
    return outstanding !== null
}

/**
 * Pass a signal on through the derivation it unwound out of, and leave that derivation DIRTY so the
 * next read of it runs the body rather than serving a value it never produced.
 *
 * Staying DIRTY costs the wake, though: `mark` stops at a node that is already DIRTY, so the flip
 * that ends the load would reach this derivation and go no further. So whoever is READING it —
 * `current` again by here, the derivation's own run having restored it — is subscribed to that flip
 * directly. The signal keeps carrying the cell it started at, which is the one that can be awaited;
 * a derivation cannot be, since nothing would pull it.
 */
function relayed(pending: Pending): Pending {
    trackerFor(pending.node).pending.read()
    return pending
}

// THE read. A failed load throws here rather than reporting `undefined` and letting a caller who
// never checked `error()` render as though nothing went wrong. The failure is read untracked — the
// subscription is to the value, and `settleError`/`settleValue` wake those readers on a flip.
// A cell that has never met a promise has no tracker and pays one null check for all of this.
function readCell(node: Node): unknown {
    const value = node.read()
    const track = node.asyncTrack
    if (track === null) return value
    // The arm that did NOT ask. It reads the value, so it gets the failure thrown at it — and the
    // throw alone is not the report: a slot's effect rethrows from a fresh microtask, which is loud in
    // a browser and is nothing at all on a server, where the walk catches it to render a failure arm.
    if (track.error.value !== undefined) {
        reportFailure(track, track.error.value)
        throw track.error.value
    }
    if (track.pending.value === true && (current !== null || willRetry)) {
        // Subscribed to the FLIP, not to the value: a load that settles to `undefined` moves no
        // value at all, so a reader holding only the value subscription would never be woken for it
        // and would sit signalling forever.
        track.pending.read()
        const signal = new Pending(node)
        outstanding = signal
        throw signal
    }
    return value
}

// Backing for `then`: the promise of the SETTLED value. Reads untracked — awaiting a cell inside an
// effect must not subscribe the effect to it, since nothing can be tracked through an await anyway.
//
// `atFirstChunk` asks for the moment `pending` stands down instead, which is the same moment for
// everything but a stream — see `Async.waiters` and `probedLoad`.
function settledPromise(node: Node, atFirstChunk = false): Promise<unknown> {
    if (node.fn !== null) {
        // Awaiting an async memo starts its load — and `await` is a CATCHER, in the same shape the
        // server walk is: a body that could not read yet is waited out and run again. Without this
        // an `await` on a derivation over a cold cell resolves the `undefined` the body never
        // returned, which is the one place the signal could still hand back an unsettled value.
        try {
            retryableCall(pullNode, node)
        } catch (error) {
            if (!(error instanceof Pending)) throw error
            // The retry re-reads the cell, so a FAILED load is thrown by the read rather than here.
            return settledPromise(error.node, atFirstChunk).then(
                () => settledPromise(node, atFirstChunk),
                () => settledPromise(node, atFirstChunk),
            )
        }
    }
    const track = node.asyncTrack
    if (track === null) return Promise.resolve(node.value)
    // A stream past its first chunk is `refreshing` with something to show, so a caller that asked
    // for the flip is already served and must not park behind the last chunk.
    if (track.pending.value === true || (track.refreshing.value === true && !atFirstChunk)) {
        return new Promise((resolve, reject) => {
            if (track.waiters === null) track.waiters = []
            track.waiters.push({ resolve, reject, atFirstChunk })
        })
    }
    if (track.error.value !== undefined) return Promise.reject(track.error.value)
    return Promise.resolve(node.value)
}

// Cleared only by `internals.quietly` — see there for why abide's own callers need it.
let kicking = true

// Cleared by `withoutReporting`, and for the same reason `kicking` exists: abide reads cells on its own
// behalf, and those reads are not somebody looking at a failure.
//
// ONE reader needs it and it is in this file — `iterate`, which reads a cell to subscribe to it and
// again to throw at its own consumer. Everything else that used to is covered without asking: `!kicking`
// below is `quietly`, which is how `repl` prints a cell, and `respond` no longer reads a value at all.
// OPT-OUT is the shape to be careful with, because a caller that forgets writes a stack nobody asked for
// and nothing goes red — so keep the exceptions enumerated from the call sites, which is the thing this
// flag got wrong twice before the set was closed.
let reporting = true

/** Read on ABIDE's behalf: a failure found here is not written to `abide:load`. */
function withoutReporting<T>(fn: () => T): T {
    const previous = reporting
    reporting = false
    try {
        return fn()
    } finally {
        reporting = previous
    }
}

// The node whose own probe is kicking a load right now, so `mark` can tell the flip this run caused
// from one that landed under it. Null outside a kick, which is every path but the one below.
let kickedBy: Node | null = null

// The last load a PROBE reported as not-yet-landed. What a server walk reads to learn that a region
// asked about a load and therefore has something to show while it runs — the fact `#compiler`'s emit
// reads off the SPELLING of an `{#if}` head, available here for any spelling at all.
//
// A single slot rather than a set: the walk asks one question, "is this region deferring", and one
// unsettled load is enough to answer it. Whichever is recorded last is the one awaited, and the arm
// re-runs after it, so a region probing two loads defers again on the second.
let probedPending: Node | null = null

/** The same for a LIVE STREAM, which is a different answer at hydration — see `kicker`. */
let probedStream = false

/** Forget what the last producer probed — the walk brackets each region with this. */
export function forgetProbedLoad(): void {
    probedPending = null
    probedStream = false
}

/**
 * A whole transcript, handed to `set` as one — what a server render already drained.
 *
 * A class rather than a plain array, because an array IS a legitimate value for a cell to hold and
 * the two must not be the same write. `set([1, 2])` holds an array; `set(transcript([1, 2]))` is a
 * stream of two chunks that is already over.
 */
export class Transcript {
    constructor(readonly chunks: readonly unknown[]) {}
}

/** Did the producer just probe a load that has not landed? */
export function hasProbedLoad(): boolean {
    return probedPending !== null
}

/** Did it probe a stream still arriving? Markup written from another point in it cannot be adopted. */
export function hasProbedStream(): boolean {
    return probedStream
}

/**
 * The settle of a load the producer just PROBED and found unlanded, or null if it probed none.
 *
 * A promise rather than the cell, because that is all a caller does with it, and it keeps `Node` off
 * an exported signature. Separate from `hasProbedLoad` because asking BUILDS that promise, and on a
 * rejecting load a promise nobody awaits is an unhandled rejection — so a caller that only wants the
 * FACT must have a way to ask that costs nothing. Both callers want one or the other, never both.
 *
 * `atFirstChunk` is what a walk with SOMEWHERE TO PATCH asks for, and it only ever differs for a
 * stream. The probe asked whether there was anything to show; the first chunk is the answer, and
 * everything after it is the client's, which drops the server's rows and restarts from the top
 * whatever they say — see `hasProbedStream`. A walk with nowhere to patch asks for the settle
 * instead, because a reader running no scripts keeps what the markup holds.
 */
export function probedLoad(atFirstChunk: boolean): Promise<unknown> | null {
    return probedPending === null ? null : settledPromise(probedPending, atFirstChunk)
}

/**
 * What a probe does before it answers: START the work without taking the value, NOTE the load if it
 * has not landed, and say whether the body SIGNALLED — the answer the tracker cannot give.
 *
 * The two kinds of not-yet-started are different nodes, which is why the start is not just
 * `beforeRead`. A KEYED slot kicks through `beforeRead`. A DERIVATION holds its load in a body that
 * has not run, and the tracker a probe reads is only written once it does — so a probe that skipped
 * the pull reported `false` on an argless `memo` forever, which is the same lie this change removed.
 *
 * RETRYABLE, and that is the third kind of not-yet: a derivation whose body reads a load ONE LEVEL
 * DOWN settles nothing of its own, so its tracker is never written however often it is pulled. Under
 * a bare `untrack` that read is not allowed to signal either — it hands back the `undefined` the
 * load has not produced, and the body MEMOISES it as a settled value, so `{#if x.pending()}` reported
 * false and the else arm rendered an empty list. The pull is a caller that will ask again, which is
 * exactly `retryableCall`'s contract: the signal comes back out, and it is this probe's answer.
 *
 * UNTRACKED, because the probes carry their own signals: subscribing the asker to the VALUE here
 * would wake a region that only asked `pending()` on every value that lands after.
 *
 * The note is what a server walk reads back, and it is taken AFTER the start, so a slot that was
 * cold a line ago is reported as the in-flight load it now is. No early return for "nothing to
 * kick", either: a `state(promise)` has nothing to start and is pending the whole time, so one would
 * hide exactly the load a deferring region is built around. A cell that never met a promise has no
 * tracker and pays one null check for all of it.
 */
function kicker(node: Node, beforeRead: (() => void) | null): () => boolean {
    const startable = beforeRead !== null || node.fn !== null
    return () => {
        if (!kicking) return false
        let signalled: Pending | null = null
        if (startable) {
            const previous = kickedBy
            kickedBy = current
            try {
                if (beforeRead !== null) beforeRead()
                // Threaded, not captured: a kick runs on EVERY probe, and `iterate` reads eight of
                // them per chunk — the captured form allocated one closure per probe per chunk to
                // make a call the engine can make directly. The same reason that loop hoists its own.
                if (node.fn !== null) untrackCall(pullRetryably, node)
            } catch (error) {
                // Starting is never where a FAILURE surfaces — a throw out of the body is reported by
                // the read that renders, exactly as `start` in `html.ts` leaves it. A SIGNAL is the
                // other way a body ends, and it is not a failure at all: it is this probe's answer.
                if (error instanceof Pending) signalled = error
            } finally {
                kickedBy = previous
            }
        }
        // The load is a CELL ONE LEVEL DOWN, and the signal is what carries it. Nothing settles this
        // derivation, so writing `pending` on its own tracker would be a flag with no writer to stand
        // it down; the cell that signalled has both — the flip that ends the load, and the promise a
        // server walk defers on. So the asker subscribes to THAT one and the walk notes THAT one,
        // which is what a direct probe of it would have done.
        if (signalled !== null) {
            probedPending = signalled.node
            relayed(signalled)
            return true
        }
        // Two facts, and they are NOT the same answer at hydration.
        //
        // PENDING is "the server's markup is right and this side does not have it yet", so a region
        // that probed one keeps what is under it and adopts on the settle.
        //
        // STREAMING is "the server DRAINED this and we restart from the top", so the markup is a
        // different point in the same stream and no later chunk makes it match — the rows are
        // rebuilt, which is what the `Streamed` branch in `#ui` has always done. Keeping them instead
        // freezes the list on the server's last chunk while a plain READ of the same cell beside it
        // counts up from one: `latest 1` over a list showing 1..5, reconciling only when the stream
        // ends. Correct output at both ends, incoherent for the whole middle.
        //
        // Separate from the node record, so `probedLoad` — what the SERVER walk defers on — still
        // answers about cold loads alone and a streaming region is walked exactly as it was.
        const track = node.asyncTrack
        if (track !== null) {
            if (track.pending.value === true) probedPending = node
            else if (track.streaming.value === true) probedStream = true
        }
        return false
    }
}

function attachAsync(read: Cell<unknown>, node: Node, beforeRead: (() => void) | null): void {
    // A PROBE KICKS THE LOAD, exactly as `()` and `await` do. Asking a cold slot `pending()` used to
    // report `false` — not "no load is running" but "none has begun", which is a different fact
    // wearing the same answer. Kicking makes the answer true and makes every probe-first spelling
    // work on its own: `{#if a.pending() || b.pending()}` and a `memo` over probes start their loads
    // for the same reason the recognised `{#if x.pending()}` did, without a compiler recognising it.
    //
    // Resolved once per cell rather than branched per call: a probe is read per region, and in a list
    // per row.
    const kick = kicker(node, beforeRead)
    // Written on every cell, so the shape stays monomorphic and `nodeOf` never misses.
    ;(read as unknown as Record<symbol, Node>)[CELL] = node
    // A body that SIGNALLED is answered from the kick rather than from this node's tracker, and the
    // three answers are the cold ones: there is nothing to serve, so `pending` is true and `settled`
    // is false. `refreshing` stays what the tracker says — a derivation that cannot finish its body
    // has no retained value to be refreshing OVER, whatever it held before the deps moved.
    read.pending = () => {
        if (kick()) return true
        return trackerFor(node).pending.read() as boolean
    }
    read.refreshing = () => {
        kick()
        return trackerFor(node).refreshing.read() as boolean
    }
    read.settled = () => {
        if (kick()) return false
        return trackerFor(node).settled.read() as boolean
    }
    // The arm that DID ask — `{:else if x.error()}`, and an app asking the same question by hand.
    // Asking is not handling it quietly: the reason is what an author puts in markup, and the stack is
    // what they need to find out why, so the ask is exactly the moment to write it down.
    read.error = () => {
        kick()
        const track = trackerFor(node)
        const reason = track.error.read()
        if (reason !== undefined) reportFailure(track, reason)
        return reason
    }
    read.chunks = () => {
        kick()
        const track = trackerFor(node)
        track.chunks.read() // the VERSION is what a reader subscribes to; the buffer is pushed into
        // The BUFFER, not a copy of it. A copy per version reads well — a reader is handed something
        // that cannot move under it — but the reader a transcript is for reads once per chunk, so the
        // copy is O(k) at chunk k and the stream is quadratic again: 4x the chunks measured 8.0x the
        // time with a live reader against 0.64x with none. What made the copy defensible was never
        // true here: a channel's `windowOf` copies too, and its copy is bounded by `tail`, while a
        // cell's transcript has no cap at all.
        //
        // Nothing in the render path identity-checks it — `ChildPart.set` clears `holding` before an
        // array and `ListPart.set` reconciles unconditionally — so what a slot renders is unchanged.
        // What a caller gives up is holding the array across an await and expecting it frozen, and
        // the version is what tells it there is more.
        return track.buffer
    }
    read.streaming = () => {
        kick()
        return trackerFor(node).streaming.read() as boolean
    }
    // Written here with the rest of the async surface, so every cell has the same shape whether or
    // not it ever meets a stream — the generator is built per loop, not per cell.
    read[Symbol.asyncIterator] = () => iterate(read)
    // No node of its own: "landed, did not fail, nothing still arriving" is exactly three nodes that
    // already exist, and reading all three is what subscribes a reader to any of them moving. A
    // fourth node would be a second record of the same fact for the settle paths to keep in step with.
    //
    // `streaming` is in the conjunction and `refreshing` is not, and that asymmetry is the point:
    // a warm reload has an OUTCOME already — the last load finished, and `done` reports that — while
    // a stream mid-flight has not produced one yet, however many chunks it has handed over.
    read.done = () => {
        if (kick()) return false
        const track = trackerFor(node)
        return (
            track.settled.read() === true &&
            track.error.read() === undefined &&
            track.streaming.read() !== true
        )
    }
    // The shared function, not a closure forwarding to it: this runs per cell, therefore per keyed row.
    read.isError = isNamedError
    read.watch = (handler: (value: unknown) => unknown) =>
        watch(read as () => unknown, handler as (value: unknown) => void)
    // Cast because `then` is generic in its two result types and this one implementation serves
    // every instantiation — the erased signature is the honest description of it.
    const target = read as unknown as {
        then: (onFulfilled?: unknown, onRejected?: unknown) => Promise<unknown>
    }
    // Branched ONCE per cell, where `beforeRead` is already in hand: awaiting a cold slot must start
    // it, or it resolves `undefined` forever. `makeCell` used to re-wrap this write with a `bind` and
    // a second closure, so a keyed slot paid three function objects per row for the one call.
    target.then =
        beforeRead === null
            ? (onFulfilled, onRejected) =>
                  settledPromise(node).then(onFulfilled as never, onRejected as never)
            : (onFulfilled, onRejected) => {
                  beforeRead()
                  return settledPromise(node).then(onFulfilled as never, onRejected as never)
              }
    // The SAME two function objects on every cell — see `Cell.catch`. Assigned here rather than left
    // to a prototype because a cell is a function and mutating a function's prototype deoptimises it.
    const verbs = read as unknown as { catch: unknown; finally: unknown }
    verbs.catch = caught
    verbs.finally = lastly
}

/**
 * `catch` and `finally`, in terms of `then` and through `this`.
 *
 * Module scope, so the two are allocated once for the process rather than per cell. `then()` with no
 * arguments already hands back a real promise, which is what makes `finally` one line and what makes
 * both agree with the native semantics they are named after.
 */
function caught(
    this: PromiseLike<unknown>,
    onRejected?: ((reason: unknown) => unknown) | null,
): Promise<unknown> {
    return this.then(undefined, onRejected) as Promise<unknown>
}

function lastly(this: PromiseLike<unknown>, onFinally?: (() => void) | null): Promise<unknown> {
    return (this.then() as Promise<unknown>).finally(onFinally)
}

// --- the seam a keyed `memo` slot sits on -----------------------------------
//
// A keyed slot IS a cell, so "a promise is a load" has ONE implementation rather than two that have
// to be kept in agreement. These are the operations a slot needs beyond the public surface, and
// every one is UNTRACKED on purpose: a slot's own bookkeeping — is a load in flight, subscribe me to
// the value — must not subscribe whoever triggered it, or a reader of the slot would wake on
// transitions it never asked about. Deliberately on neither front door — not `abide.ts`, which is
// the `.` export, and not `src/shared/runtime.ts`, which is `./runtime`.

// Where a cell keeps its node. Graph-internal and deliberately NOT the brand a renderer checks: the
// brand answers "should a slot read this?", which is a wider question than "does this have a node"
// — a channel has no node and is still a source. `#shared/internal/BRANDS.ts` owns that one.
const CELL = Symbol.for('abide.cell')

function nodeOf(cell: Cell<unknown>): Node {
    return (cell as unknown as Record<symbol, Node>)[CELL] as Node
}

export const internals = {
    /**
     * A cell that has NOT settled: `undefined` is what it holds, not what it loaded. `beforeRead`
     * fires on `()`, on `await` and on every probe — so a slot kicks its own load from any question
     * asked of it, while `peek` alone still starts nothing.
     */
    cold<T>(beforeRead: () => void, transform?: (value: unknown) => unknown): State<T | undefined> {
        const node = new Node(undefined, null)
        if (transform !== undefined) node.transform = transform
        return makeCell(node, beforeRead) as State<T | undefined>
    },
    /** A derivation whose read runs `beforeRead` first — how an argless memo applies its ttl. */
    derived<T>(fn: () => unknown, beforeRead: () => void, transform?: (value: unknown) => unknown): Memo<T> {
        return makeDerived(fn, beforeRead, transform) as Memo<T>
    },
    loading<T>(cell: Cell<T>): boolean {
        const track = nodeOf(cell as Cell<unknown>).asyncTrack
        return track !== null && (track.pending.value === true || track.refreshing.value === true)
    },
    /**
     * Ask probes WITHOUT starting anything — for machinery routing or inspecting rather than
     * displaying.
     *
     * A probe kicks the load now, which is right for an author asking in order to show something and
     * wrong for every internal caller asking in order to decide what to do. Both of abide's own were
     * bugs the moment probes started causing: the rpc responder asks `streaming()` one line after
     * `handle()` already started the work, and on a MUTATION slot — stale by design, so that every
     * ask runs it — the second kick ran the handler a SECOND time; and `repl` asks three of them to
     * choose how to PRINT a source, which warmed every cold memo it displayed.
     *
     * A flag rather than a non-kicking twin per question, so a probe added later needs nothing here.
     */
    quietly<T>(fn: () => T): T {
        const previous = kicking
        kicking = false
        try {
            return fn()
        } finally {
            kicking = previous
        }
    },
    /** Settle a failure IN THE CALL, for a body that threw synchronously. */
    fail<T>(cell: Cell<T>, error: unknown): void {
        const node = nodeOf(cell as Cell<unknown>)
        trackerFor(node).generation++
        settleError(node, error)
    },
}

// Un-settle: drop the value and the error, cancel what is in flight, back to cold. This is
// `invalidate` on every cell — the verb that says the data is WRONG, as opposed to `refresh`, which
// says it may be stale and needs a body to re-run.
function resetNode(node: Node): void {
    const track = node.asyncTrack
    if (track !== null) {
        track.generation++ // whatever is in flight is no longer wanted
        const wasFailed = track.error.value !== undefined
        clearError(track)
        standDown(track)
        track.settled.write(false)
        resetChunks(track)
        if (wasFailed) wakeReaders(node)
        if (track.waiters !== null) {
            finish(track, new Error('abide: invalidated before the load settled'), true)
        }
    }
    node.hasValue = false
    node.write(undefined)
}

// --- iterating a cell -------------------------------------------------------

/** The cursor's "no transcript yet" start. A sentinel, so the first look adopts the live buffer. */
const NOTHING_YET: readonly never[] = []

/**
 * `for await (const chunk of cell)` — everything the cell has already produced, then everything that
 * comes next.
 *
 * The replay is what makes it a CELL rather than a subscription: a second consumer of a stream that
 * has already run gets the whole of it, because the transcript is retained. A failure is ASKED about
 * rather than caught around the read, so the throw comes from the loop consuming it and not from
 * whichever reader happened to kick the load.
 *
 * This is where `chunks()` stops being the only way to read a stream, and it is the reason `chunks()`
 * can hand back the live buffer: the reader that must not see it move is the one that re-reads the
 * whole thing, and this one never re-reads anything.
 */
async function* iterate<T>(cell: Cell<T>): AsyncGenerator<T> {
    let wake: (() => void) | null = null
    // LEVEL-triggered, not edge-triggered. A generator spends most of its life suspended at a
    // `yield` waiting for its consumer, and every chunk that lands in that window would otherwise
    // wake nobody: the flag is what the loop checks before parking, so a producer faster than the
    // consumer cannot strand it. Over a real socket that is the common case, not the rare one.
    let moved = false
    const watcher = watchNode(() => {
        // This body only wants to be WOKEN — what it reads is the version behind `chunks()`, and the
        // buffer it hands back is walked by the cursor below rather than here.
        cell.chunks()
        cell.streaming()
        cell.settled()
        // UNREPORTED, and so are the two below: waking on a failure is not looking at one. The loop
        // throws it at its own consumer, which either catches it or raises an unhandled rejection
        // already carrying the stack — the same reason an `await` is not a read.
        withoutReporting(cell.error)
        moved = true
        const resume = wake
        wake = null
        resume?.()
    })
    try {
        // The read is what starts the load. Untracked: this generator is not a reactive reader, and
        // it may well be running inside someone else's effect.
        untrack(() => {
            try {
                withoutReporting(cell)
            } catch {
                // Asked about below, where the loop can throw it at its own consumer.
            }
        })
        let at = 0
        let finished = false
        // The LIVE buffer, walked with a cursor: this loop only ever reads the tail it has not
        // reached yet, so it holds an index rather than re-reading the whole transcript per chunk.
        let produced: readonly T[] = NOTHING_YET
        // Closures built ONCE for the whole loop rather than one per probe per turn: this runs per
        // chunk, and a producer faster than its consumer is the common case over a socket.
        const look = (): void => {
            // ASKED BEFORE the transcript is read, and that order is the whole of it: a stream that
            // ended between the two reads has already written its last chunk, so reading the
            // transcript second cannot miss one. The other order drops the final chunk every time.
            finished = cell.settled() && !cell.streaming()
            const held = cell.chunks() as readonly T[]
            // A new array means the transcript was REPLACED — dropped on overflow, or reset by a
            // reload — rather than appended to, and a cursor into the old one indexes nothing.
            if (held !== produced) {
                produced = held
                at = 0
            }
        }
        // Asked AFTER the transcript is handed over, so a failure that arrived while this was
        // suspended at a `yield` is thrown by the loop that was waiting on it.
        const asked = (): unknown => withoutReporting(cell.error)
        // Hoisted for the same reason as the two above, which this used to sit seventeen lines under
        // while allocating a fresh executor per turn.
        const park = (resolve: () => void): void => {
            wake = resolve
        }
        for (;;) {
            moved = false
            untrack(look)
            while (at < produced.length) yield produced[at++] as T
            const failure = untrack(asked)
            if (failure !== undefined) throw failure
            if (finished) {
                // A cell that never streamed has no transcript, so the loop hands over the value
                // itself and ends. One shape reads both.
                if (at === 0) {
                    const value = untrack(() => cell.peek())
                    if (value !== undefined) yield value as T
                }
                return
            }
            if (moved) continue // something landed while this was suspended at a `yield`
            await new Promise<void>(park)
        }
    } finally {
        watcher.dispose()
    }
}

// --- the surface ----------------------------------------------------------

/**
 * A CELL: a value that can change, and that tells whoever read it when it does.
 *
 * That is the whole reason it exists. A plain `string` cannot announce that it moved, so anything
 * showing it would have to be told to look again. Reading a cell IS the subscription — no dependency
 * list, no re-render call — which is why a template that names one updates itself.
 *
 * It is also the one public name an author reads without ever writing: `state()` returns one, every
 * prop is one, and a `memo` is one with a body. So a hover says `Cell<string>` about a local that was
 * declared as a `string` and never spelled a type. In markup the name alone is the read — `{title}` —
 * and the explicit `title()` / `title.set(v)` spelling is what the sugar sits over, never instead of.
 *
 * The vocabulary is abide's, not the textbook one: `state` (own) / `memo` (derive) / `watch`
 * (react). `signal` is deliberately not a name here — abide retired it to avoid colliding with the
 * TC39 Signals proposal, and a cell is CALLABLE (`x()` read, `x.set(v)` write, `x.peek()` untracked)
 * rather than an object with `.value`.
 *
 * Every cell carries the same async surface, and a purely sync cell answers it honestly: `settled()`
 * true, `pending()` false, `error()` undefined, `await x` already resolved.
 *
 * One surface, uniformly: reads (`()`, `peek`), probes (`pending`/`refreshing`/`error`/`settled`),
 * and the two verbs that need no body — `set` (this IS the value) and `invalidate` (this is WRONG).
 * `refresh` is the one verb that is NOT here, because re-running requires a body to re-run; it lives
 * on `Memo` and on a keyed handle. `dispose` likewise: only a derivation owns subscriptions.
 */
export interface Cell<T> extends PromiseLike<T> {
    /**
     * The other two thenable verbs, so `x.catch(…)` is not a `TypeError` on a value `await` accepts.
     *
     * A cell is a PromiseLike and not a Promise — there is no `[[PromiseState]]` under it — so these
     * are the two `Promise.prototype` gives a real one, and nothing else. `instanceof Promise` stays
     * FALSE on purpose: an object claiming to be one and then failing a native fast path is worse
     * than a thenable that says what it is.
     *
     * Both are ONE shared function each, not a closure per cell. They reach the cell through `this`,
     * which is what keeps them free on an object allocated per keyed slot — per row, in a list.
     */
    catch<Rejected = never>(
        onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
    ): Promise<T | Rejected>
    finally(onFinally?: (() => void) | null): Promise<T>
    /**
     * The value. THROWS if the last load failed — a caller that ignores it is not handling it — and
     * SIGNALS where re-running is the recovery, which is why the type carries no `| undefined` for a
     * load that has not landed: in a slot thunk, a `memo` body or an effect body the read either
     * hands back the value or does not return at all.
     */
    (): T
    /**
     * The retained value, subscribing to nothing, never throwing and never signalling — so
     * `undefined` here means NOTHING HAS LANDED YET. The escape hatch, and the read a `<script>`
     * gets, where nobody would run the body a second time.
     */
    peek(): T | undefined
    /**
     * Write it directly. A promise here is a LOAD and an async iterable is a STREAM; anything else
     * settles the cell in the call.
     */
    set(value: T | Promise<T> | AsyncIterable<T>): void
    /** Drop the value and any error, cancel what is in flight, and go back to cold. */
    invalidate(): void
    /**
     * Everything a stream has produced so far, in order. Empty on a cell that never streamed.
     *
     * The LIVE transcript, not a copy of it: a slot that renders one re-reads it per chunk, and a
     * copy per read is a full array per chunk — quadratic over the stream. Read it, render it, and
     * let the next version wake you; to consume it in order, iterate the cell instead.
     */
    chunks(): T[]
    /** A cold load is in flight — nothing retained to show. */
    pending(): boolean
    /** A load is in flight OVER a retained value. Its own signal; never wakes value readers. */
    refreshing(): boolean
    /** Chunks are still arriving. */
    streaming(): boolean
    /** The last load's rejection, or `undefined`. Probes never throw. */
    error(): unknown
    /** Has a value or an error ever landed? */
    settled(): boolean
    /**
     * It landed, it did not fail, and nothing is still arriving — as opposed to `settled()`, which
     * is true however it finished.
     */
    done(): boolean
    /**
     * Is a caught failure the one named `name` — directly, or wrapped as another's `cause`?
     *
     * The NAME, not the class: an error that crossed a wire arrives as a plain object, and
     * `instanceof` on it is false however faithfully it was serialised.
     */
    isError(error: unknown, name: string): boolean
    /**
     * Run `handler` with the value now, and again whenever it changes. The dependency is DECLARED,
     * so the handler is untracked — what it reads does not subscribe it. Returns the disposer, and a
     * function the handler returns is the teardown, exactly as in `watch`.
     */
    // biome-ignore lint/suspicious/noConfusingVoidType: the union IS the contract — a handler either returns nothing or returns its teardown.
    watch(handler: (value: T) => void | (() => void)): () => void
    /**
     * `for await (const chunk of cell)` — everything it has produced, then everything that comes
     * next. The cursor face of `chunks()`, for a consumer that reads in order and never re-reads.
     *
     * A cell that never streamed yields its value once and ends, so one loop reads both shapes.
     */
    [Symbol.asyncIterator](): AsyncIterator<T>
    /** Narrowed from `PromiseLike` to a real promise — `await x`, and `.catch` on the result. */
    then<Fulfilled = T, Rejected = never>(
        onFulfilled?: ((value: T) => Fulfilled | PromiseLike<Fulfilled>) | null,
        onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
    ): Promise<Fulfilled | Rejected>
}

/**
 * A cell you own outright that had its value before anything could read it — `state(v)`, a prop cell,
 * a `state.shared` slot.
 *
 * The one thing it adds is that `peek` cannot miss: nothing was ever in flight, so there is no moment
 * where the retained value is absent. That is what keeps `count += 1` — which desugars to
 * `count.set(count.peek() + 1)`, because a write must not subscribe — from needing a narrowing that
 * could never fail. A cell handed a promise is a `Cell` instead, and there the same write is an error
 * worth having.
 */
export interface State<T> extends Cell<T> {
    peek(): T
}

export interface Memo<T> extends Cell<T> {
    /** Re-run the body NOW, keeping the current value served until the new one lands. */
    refresh(): void
    dispose(): void
}

// `beforeRead` runs on every operation that ASKS ABOUT THE VALUE — `x()`, `await x`, and the probes.
// That is the seam a keyed slot kicks its load through: SELECTING a slot starts nothing, and asking
// it anything does. `peek` is the one member left that does not, which is what keeps it a question.
function makeCell(node: Node, beforeRead: (() => void) | null): State<unknown> {
    // Every cell is a source, which is what a slot recognises. Branded before anything else is
    // assigned so the shape stays monomorphic.
    const read = markSource(
        (beforeRead === null
            ? () => readCell(node)
            : () => {
                  beforeRead()
                  return readCell(node)
              }) as State<unknown>,
    )
    read.set = (value: unknown) => {
        // Stream before load — see `isAsyncIterable` for why the order is the contract and not an
        // accident. `x = someRpcHandle` lands here, and a handle is both shapes.
        if (isAsyncIterable(value)) {
            consume(node, value)
            return
        }
        if (isThenable(value)) {
            adopt(node, value)
            return
        }
        // The third shape, and the rule reads the same as the other two: a promise is a LOAD, an
        // async iterable is a STREAM, and a `Transcript` is a stream that already happened. Third
        // rather than first so the two live shapes reach their arms on the checks they always did;
        // what it costs is one `instanceof` on the plain-value path.
        if (value instanceof Transcript) {
            adoptTranscript(node, value.chunks)
            return
        }
        const track = node.asyncTrack
        // A sync write is the newer answer: it CANCELS whatever is in flight.
        if (track !== null) {
            track.generation++
            settleValue(node, value) // transforms on the way in
        } else if (node.transform === null) {
            node.hasValue = true
            node.write(value)
        } else {
            const shaped = transformValue(node, value)
            // ADOPTED: the transform handed back a promise and it is in flight, so nothing is held
            // yet — `hasValue` stays where it was and the settle writes the node. The `CLEAN` below
            // is still owed either way: the write is the newer answer whether or not it has landed.
            if (shaped !== ADOPTED) {
                node.hasValue = true
                node.write(shaped)
            }
        }
        // On a DERIVATION the write is now the current value, so the body must not be re-run out
        // from under it on the next read. It runs again when a dependency moves, or on `refresh` —
        // which is exactly "a local write holds until the next real load replaces it".
        if (node.fn !== null) node.status = CLEAN
    }
    // What is RETAINED, and nothing more. Deliberately not `node.peek()`, which recomputes a stale
    // derivation: now that a derivation can hold a load, computing here would make `peek` start one
    // — and a peek that causes work is not a peek. `undefined` means nothing has landed yet, which
    // is the same answer a never-read slot gives.
    read.peek = () => node.value
    read.invalidate = () => resetNode(node)
    attachAsync(read, node, beforeRead)
    return read
}

// A promise or a stream is a LOAD, so the cell starts COLD — which is the whole of the difference
// between the two return types. The read is `T` either way, because a read that cannot answer yet
// signals rather than reporting `undefined`; what a load costs is `peek`, which is the one place the
// absence is still visible.
/**
 * A cell holding a value you write yourself — `state(0)`, then `count()` to read and `count.set(1)`
 * to write. Inside a `.abide` file the sugar does both by name.
 *
 * A promise or async iterable starts the same cell COLD: it is `pending()` until the first value
 * lands, and the read signals rather than answering `undefined`.
 */
export function state<T>(initial: Promise<T>, transform?: (value: T) => T): Cell<T>
export function state<T>(initial: AsyncIterable<T>, transform?: (value: T) => T): Cell<T>
export function state<T>(initial: T, transform?: (value: T) => T): State<T>
// biome-ignore lint/suspicious/noExplicitAny: the overloads above ARE the public type; unifying them in the implementation signature would widen the two return types the overloads exist to keep apart.
export function state(initial: unknown, transform?: (value: unknown) => unknown): any {
    const node = new Node(undefined, null)
    if (transform !== undefined) node.transform = transform
    // Same order as `set` below, for the same reason — see `isAsyncIterable`.
    if (isAsyncIterable(initial)) {
        consume(node, initial)
    } else if (isThenable(initial)) {
        adopt(node, initial)
    } else if (transform === undefined) {
        node.value = initial
        node.hasValue = true
    } else {
        // The initial IS the first write — a clamp that let an out-of-range initial through would be
        // a clamp with a hole in it exactly where the value came from the author rather than a user.
        //
        // And it is a write, so it obeys the write's law: a promise back from the transform is a LOAD.
        // Excluding this site on the strength of `(value: T) => T` was excluding it by a CHECKER fact
        // in a project whose first rule is that the javascript lane compiles too — and the hole was
        // exactly the shape `transformValue` exists to close, one call earlier. `state(5, async …)`
        // held the promise as its value, `pending()` was false and the read handed a promise back
        // forever, while the SAME transform through `set` adopted correctly: one cell, two laws.
        const shaped = transformValue(node, initial)
        // ADOPTED: the initial is in flight, so `hasValue` stays false — which is what `markStarted`
        // reads as cold — and the settle writes the node.
        if (shaped !== ADOPTED) {
            node.value = shaped
            node.hasValue = true
        }
    }
    return makeCell(node, null)
}

// Cells shared BY KEY rather than by reference, and the map they live in.
//
// Per-caller, for the same reason a memo's cache is: a module-level map is filled once and outlives
// the request that filled it, so on a server "shared across every component instance" would quietly
// mean "shared across every visitor". `SHARED` is the fallback every caller uses when there is no
// caller scope — a client, a script, a test — where there is one caller forever.
const SHARED = new Map<string, State<unknown>>()
const makeShared = (): Map<string, State<unknown>> => new Map()

/**
 * One cell per `key`, handed to every caller that asks for that key. The first call decides the
 * value; later ones get the cell that already exists and their `initial` is not consulted.
 */
state.shared = <T>(key: string, initial: T, transform?: (value: T) => T): State<T> => {
    const held = storeFor(SHARED, makeShared, SHARED)
    const existing = held.get(key)
    if (existing !== undefined) return existing as State<T>
    const made = state(initial, transform as never) as State<unknown>
    held.set(key, made)
    return made as State<T>
}

/**
 * A cell declared at MODULE scope, resolved per caller on every member — what a `<script module>`
 * binding compiles to.
 *
 * `state.shared` cannot serve this and that is the whole reason this exists: it scopes the LOOKUP,
 * so a declaration that runs once still closes over the one cell the first evaluation built, and
 * every request afterwards reads that. Here the BINDING is the facade and the node behind it varies,
 * which is the same answer `scopedArgless` gives an argless `memo` — this is that mechanism reaching
 * the one reactive spelling it never covered.
 *
 * `make` is a thunk rather than a value because the initial has to be built PER CALLER: `state(0)`
 * would share the zero harmlessly and `state(ticking())` would hand every request the same generator,
 * which is the bug wearing a different hat.
 *
 * The fallback is built eagerly, as `scopedArgless` builds its own: where there is no caller scope —
 * a client, a script, a test — there is one caller forever, and a lazy one would put a null check on
 * the hot path to save an allocation that a client makes exactly once per module.
 */
// Generic over the CELL rather than its value: `state(0)` is a `State<T>` whose `peek` cannot miss
// and `state(promise)` is a `Cell<T>` whose can, and collapsing the two here would put a
// `T | undefined` under every `count += 1` the desugar writes.
state.scoped = <C extends Cell<unknown>>(make: () => C): C => {
    // LAZY where `scopedArgless` is eager, and the difference is what the two BUILD: constructing a
    // memo runs nothing, and constructing a cell runs its initial. An eager fallback here starts a
    // promise or a stream at module load, on a server, once for the PROCESS and before any request
    // exists — which is the thing being scoped in the first place.
    let fallback: C | undefined
    const ofNobody = (): C => (fallback ??= make())
    const pick = (): C => storeForLazy(pick, make, ofNobody)
    // The facade is a SOURCE like the cell it stands for, so a slot reads it rather than rendering a
    // function. Deliberately no `abide.cell`: that symbol names one node and the node varies here,
    // which is the same reason `scopedArgless` withholds it.
    const facade = markSource((() => pick()()) as unknown as C)
    Object.assign(facade, cellForward(pick as () => Cell<unknown>))
    return facade
}

/**
 * The whole cell surface, forwarded to whatever `pick` resolves to at the moment of the call.
 *
 * A TABLE typed by `keyof Cell`, so a member added to the cell surface is a type error HERE rather
 * than an `undefined` that only shows up on a server — and ONE table, because that check is the only
 * reason it is written this way. `state.scoped` above and `memo`'s `scopedArgless` had a copy each,
 * sixteen members apart from the memo's own two verbs, so the guarantee each of them claimed singly
 * had to be repaired in two files. A scoped memo `Omit`s its extra verbs on at its own call site,
 * which keeps that surface exhaustively checked too.
 */
export function cellForward(pick: () => Cell<unknown>): { [K in keyof Cell<unknown>]: Cell<unknown>[K] } {
    return {
        peek: () => pick().peek(),
        set: (value) => pick().set(value),
        invalidate: () => pick().invalidate(),
        chunks: () => pick().chunks(),
        pending: () => pick().pending(),
        refreshing: () => pick().refreshing(),
        streaming: () => pick().streaming(),
        error: () => pick().error(),
        settled: () => pick().settled(),
        done: () => pick().done(),
        isError: (error, name) => pick().isError(error, name),
        watch: (handler) => pick().watch(handler),
        [Symbol.asyncIterator]: () => pick()[Symbol.asyncIterator](),
        // Cast for the same reason `attachAsync` casts: one implementation serves every instantiation
        // of `then`'s two type parameters, and the erased signature is the honest description of it.
        then: ((onFulfilled: unknown, onRejected: unknown) =>
            (pick() as unknown as { then: (a?: unknown, b?: unknown) => Promise<unknown> }).then(
                onFulfilled,
                onRejected,
            )) as Cell<unknown>['then'],
        // The SAME shared pair every cell carries rather than forwarders of their own: both reach the
        // facade through `this`, and its `then` above is what puts the caller's cell behind them. A
        // closure here would be two more allocations per caller AND a different function object,
        // which is the thing the identity assertion in `demos/memo.ts` is watching for.
        catch: caught as Cell<unknown>['catch'],
        finally: lastly as Cell<unknown>['finally'],
    }
}

// The ARGLESS form of abide's `memo`: auto-tracked derivation, lazy, memoised on identity. A body
// that returns a promise becomes a load — its dependencies are the ones read BEFORE the first
// `await`, which is everything tracking can honestly see. Args-keyed memoisation lives in `memo.ts`.
export function derive<T>(fn: () => Promise<T>, transform?: (value: T) => unknown): Memo<T>
export function derive<T>(fn: () => AsyncIterable<T>, transform?: (value: T) => unknown): Memo<T>
export function derive<T>(fn: () => T, transform?: (value: T) => unknown): Memo<T>
// biome-ignore lint/suspicious/noExplicitAny: the overloads above ARE the public type; unifying them in the implementation signature would widen the two return types the overloads exist to keep apart.
export function derive(fn: () => unknown, transform?: (value: unknown) => unknown): any {
    return makeDerived(fn, null, transform)
}

function makeDerived(
    fn: () => unknown,
    beforeRead: (() => void) | null,
    transform?: (value: unknown) => unknown,
): Memo<unknown> {
    const node = new Node(undefined, fn)
    if (transform !== undefined) node.transform = transform
    const read = makeCell(node, beforeRead) as Memo<unknown>
    // Re-run NOW. A load started by the body reports `refreshing` over the retained value, so the
    // old one keeps being served — the same shape a keyed slot's refresh has.
    // Both verbs check DEAD first because both WRITE the status: assigning DIRTY over DEAD undoes
    // the disposal, and the guards inside `pull`/`resetNode` then have nothing left to see. A
    // disposed derivation refreshed by a surviving timer or by `refresh({ tags })` came back to
    // life, re-subscribed to every source, and had no owner left to dispose it a second time.
    read.refresh = () => {
        if (node.status === DEAD) return
        node.status = DIRTY
        node.pull()
    }
    // Dropping the value is not enough on a derivation: without re-marking it, the node is CLEAN and
    // holding `undefined`, so nothing would ever recompute it until a dependency happened to move.
    read.invalidate = () => {
        if (node.status === DEAD) return
        node.status = DIRTY
        resetNode(node)
    }
    read.dispose = () => node.dispose()
    return read
}

// `watch` is the effect, and its RETURN is the lifecycle hook: a returned function is the teardown,
// run before every re-run and once on disposal. That is why there is no onMount/onDestroy.
//
// A watch created inside a `scope` REGISTERS with it automatically. There is deliberately no second
// opt-in spelling: an ownership rule that only applies when you remember to use the other function
// is not an ownership rule, and the failure mode is a leak nobody sees.
//
// `watch(source, handler)` is the same effect with its dependency DECLARED rather than discovered:
// the source is the only thing read under tracking, so the handler is free to read whatever it likes
// without subscribing to it. That is the whole difference — one body, two ways of saying what wakes it.
/**
 * Runs side effects. Reading a source inside the body IS the subscription — there is nothing to
 * declare — and the run is batched onto a microtask.
 *
 * Returns the disposer. A handler may return its own teardown, which runs before each re-run and
 * once at dispose.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: the union IS the contract — an effect either returns nothing or returns its teardown, and that is the whole lifecycle story.
export function watch(fn: () => void | (() => void)): () => void
export function watch<T>(
    source: () => T,
    // biome-ignore lint/suspicious/noConfusingVoidType: same contract, one argument along.
    handler: (value: T) => void | (() => void),
): () => void
export function watch(first: () => unknown, handler?: (value: unknown) => unknown): () => void {
    let body: () => unknown = first
    if (handler !== undefined) {
        // Hoisted rather than `untrack(() => handler(value))`: an effect re-runs, and the closure
        // form allocates one per run for a call the engine can make directly.
        body = () => untrackCall(handler, first())
    }
    const node = new Node(undefined, body, true)
    node.pull()
    const dispose = (): void => node.dispose()
    if (collecting !== null) collecting.push(dispose)
    return dispose
}

/**
 * The effect NODE, for a caller that will re-run it in place rather than build another.
 *
 * `watch` hands back a disposer because that is all an ordinary caller may do with an effect. A slot
 * binder is the one caller that knows its own body reads a MUTABLE FIELD, so the same node serves
 * every patch: `rerun` is then a detach-and-run with no Node, no observer Set and no closures, where
 * dispose-and-rebuild allocated all three per slot per patch.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: same contract as `watch` — an effect either returns nothing or returns its teardown.
export function watchNode(fn: () => void | (() => void)): Node {
    const node = new Node(undefined, fn as () => unknown, true)
    node.pull()
    // No `collecting` registration, unlike `watch` beside it: the caller is handed the NODE and owns
    // it — `Instance` keeps it in `slotEffects` and disposes it — so a disposer here would be a
    // wrapper closure allocated per reactive slot per row solely to dispose something twice. `watch`
    // pushes the function it had to allocate for its return value anyway.
    return node
}

/**
 * An effect declared at MODULE scope, run once per CALLER — what a `<script module>` `watch` compiles
 * to, and the last of the three spellings that meant "once for the server process".
 *
 * A cell can be lazy because something eventually READS it; an effect has no read to wait for, so
 * something has to ask. The component whose module block declared it is what asks: its setup calls
 * this, and the first instance in a caller runs the body while every instance after it gets the
 * disposer already made. A component nobody renders in this request runs no effect in it, which is
 * the honest reading of "per caller" and is what module scope could never say before.
 *
 * The disposer is registered with the caller, so an effect goes when the request does. Where there is
 * no caller scope — a client, a script, a test — `disposeWith` is a no-op and the effect lives for
 * the page, which is exactly how a module-level `watch` behaved there already.
 */
export function scopedEffect(make: () => () => void): () => void {
    let ofNobody: (() => void) | undefined
    const start = (): (() => void) => {
        const stop = make()
        disposeWith(stop)
        return stop
    }
    const pick = (): (() => void) => storeForLazy(pick, start, () => (ofNobody ??= start()))
    return () => void pick()
}

/**
 * Run an effect node NOW. Its sources are re-collected, so a new body is adopted.
 *
 * The ONE way an effect runs — `pull`'s DIRTY arm comes through here as well — so the two invariants
 * below are stated once rather than in both.
 */
export function rerun(node: Node): void {
    if (node.status === DEAD) return
    node.runState = RUNNING
    try {
        node.run()
    } catch (error) {
        // A body that could not read yet has not RUN — there is nothing to report and nothing to
        // undo. The signalling read subscribed this node to the flip that ends the load, so the body
        // runs again the moment it can.
        if (!(error instanceof Pending)) throw error
    } finally {
        // In a `finally`, because a body that THROWS has still left the run: left `RUNNING`, every
        // later mark would be recorded for a run that is over and the effect would be dead for the
        // life of the page — which is the thing `flush`'s reset to CLEAN exists to prevent.
        node.finishRun()
    }
}

/** `untrackCall` for a caller that already holds a thunk. */
export function untrack<T>(fn: () => T): T {
    return untrackCall(callThunk, fn)
}

// `untrack(() => binder(value))` with the argument threaded through instead of captured.
//
// The closure is the cost: a template slot writes its value untracked on every patch, so the
// captured form allocates one closure per slot per row per update — on a thousand-row list that is a
// thousand allocations to make a call the engine could have made directly. Internal, because the
// argless `untrack` is the spelling authors want and this one only pays off in a loop.
export function untrackCall<A, T>(fn: (arg: A) => T, arg: A): T {
    const previous = current
    current = null
    try {
        return fn(arg)
    } finally {
        current = previous
    }
}

// Run every effect created inside `fn` under one handle, so a subtree can be torn down at once.
// This is the whole lifecycle story: no onMount/onDestroy, just a disposer.
export function scope<T>(fn: () => T): { value: T; dispose: () => void } {
    const disposers: (() => void)[] = []
    const previous = collecting
    collecting = disposers
    try {
        return {
            value: fn(),
            dispose: () => {
                for (let i = disposers.length - 1; i >= 0; i--) (disposers[i] as () => void)()
                disposers.length = 0
            },
        }
    } finally {
        collecting = previous
    }
}
