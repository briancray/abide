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
// any split along those lines is an import cycle, not a seam. `$shared/reactive.ts` is the public
// face of what is here; nothing outside abide imports this module.

import { markSource } from './BRANDS.ts'
import { isThenable } from './probes.ts'

// Annotated `number` rather than left as literal types: `status` is mutated re-entrantly (a source's
// `pull()` can promote this node to DIRTY mid-loop), so literal narrowing would make the compiler
// reject a comparison that is exactly the point of the loop.
const CLEAN: number = 0
const CHECK: number = 1
const DIRTY: number = 2
const DEAD: number = 3

let current: Node | null = null
let queue: Node[] = []
let scheduled = false
let collecting: (() => void)[] | null = null

export class Node {
    value: unknown
    fn: (() => unknown) | null
    status: number
    isEffect: boolean
    sources: Node[] = []
    // Allocating this lazily — null until something reads the node under tracking, which an effect
    // never is — was tried and reverted. It is a real allocation avoided on most nodes, and it is
    // worth 2.5 ns of the 10.5 ns a node costs to construct: measurable, and not worth a null check
    // on the five hot paths that iterate it. Reusing the `sources` array across runs instead of
    // replacing it went the same way, at 2 ns of 60.
    observers = new Set<Node>()
    cleanup: (() => void) | null = null
    // A settled value is present. Distinguishes "loaded undefined" from "never loaded", and is what
    // decides cold-pending vs warm-refreshing on the next load.
    hasValue = false
    // Allocated on first contact with a promise or a probe, never before.
    asyncTrack: Async | null = null

    constructor(payload: unknown, fn: (() => unknown) | null, isEffect = false) {
        this.fn = fn
        this.isEffect = isEffect
        this.value = payload
        this.status = fn === null ? CLEAN : DIRTY
    }

    read(): unknown {
        if (current !== null) {
            current.sources.push(this)
            this.observers.add(current)
        }
        if (this.fn !== null) this.pull()
        return this.value
    }

    peek(): unknown {
        if (this.fn !== null) this.pull()
        return this.value
    }

    write(next: unknown): void {
        if (this.value === next) return
        this.value = next
        for (const observer of this.observers) observer.mark(DIRTY)
    }

    mark(next: number): void {
        if (this.status >= next) return
        if (this.status === CLEAN && this.isEffect) {
            queue.push(this)
            if (!scheduled) {
                scheduled = true
                queueMicrotask(flush)
            }
        }
        this.status = next
        for (const observer of this.observers) observer.mark(CHECK)
    }

    pull(): void {
        if (this.status === CLEAN || this.status === DEAD) return
        if (this.status === CHECK) {
            for (const source of this.sources) {
                source.pull()
                if (this.status === DIRTY) break
            }
        }
        if (this.status === DIRTY) this.run()
        this.status = CLEAN
    }

    run(): void {
        // Detach from every source; the run re-collects them.
        for (const source of this.sources) source.observers.delete(this)
        this.sources = []

        if (this.cleanup !== null) {
            const teardown = this.cleanup
            this.cleanup = null
            // A teardown must not subscribe the effect to whatever it touches.
            untrack(teardown)
        }

        const previous = current
        current = this
        const before = this.value
        let next: unknown
        try {
            next = this.fn!()
        } finally {
            current = previous
        }

        if (this.isEffect) {
            this.cleanup = typeof next === 'function' ? (next as () => void) : null
            return
        }
        // A promise is a LOAD, not a value: keep serving what is retained and write the node when it
        // lands. Deps read before the body's first `await` are already tracked by the run above, so
        // a re-run re-adopts and the stale settle is discarded by generation.
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
        // Memoise: only wake observers when the derived value actually moved.
        if (before !== next) for (const observer of this.observers) observer.status = DIRTY
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
            track.pending.write(false)
            track.refreshing.write(false)
            if (track.waiters !== null) {
                finish(track, new Error('abide: disposed before the load settled'), true)
            }
        }
        if (this.cleanup !== null) {
            const teardown = this.cleanup
            this.cleanup = null
            untrack(teardown)
        }
        for (const source of this.sources) source.observers.delete(this)
        this.sources = []
        this.observers.clear()
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

// --- async cells ----------------------------------------------------------
//
// Handing a cell a promise — `state(fetchUser())`, `x.set(p)`, or an argless `memo` body that
// returns one — starts a LOAD instead of storing the promise. The read stays the same call it always
// was and serves the retained value (`undefined` if nothing is retained yet); the node is written
// once the promise lands. That is the whole of "sync or async, same read".
//
// The bookkeeping below is allocated on first contact with a promise or a probe, never before, so a
// cell that only ever holds sync values still costs exactly one Node.

interface Waiter {
    resolve(value: unknown): void
    reject(reason: unknown): void
}

// Four one-bit nodes rather than one status record, for the same reason `memo`'s slot keeps
// `refreshing` separate: each probe must wake only on ITS OWN transition. A status record makes
// `pending()` wake on a warm refresh it reports `false` for, and the identity check on a rebuilt
// record never holds, so every settle would wake every reader.
class Async {
    readonly pending = new Node(false, null) // cold — a load in flight with nothing to show
    readonly refreshing = new Node(false, null) // warm — a load in flight OVER a retained value
    readonly settled: Node
    /**
     * The failure, and the ONLY record of one: `undefined` here IS "not failed". That is what
     * `REJECTED_WITH_UNDEFINED` buys — a rejection can never write `undefined` — and it is why there
     * is no second `failed` flag for the four settle paths to keep in step with.
     */
    readonly error = new Node(undefined, null)
    // A later write must win even when an earlier promise settles after it. Without the stamp a slow
    // first load lands on top of the fast second one and the cell reports the value nobody asked for.
    generation = 0
    waiters: Waiter[] | null = null

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

function adopt(node: Node, promise: PromiseLike<unknown>): void {
    const track = trackerFor(node)
    const generation = ++track.generation
    // COLD (nothing retained) → `pending`, because there is genuinely nothing to show. WARM (a value
    // is held) → only `refreshing` moves, so the retained value keeps being served and its readers
    // stay asleep until the load actually changes it.
    //
    // A retained `undefined` counts as COLD: `state(undefined)` has settled, but it has nothing to
    // keep showing, and a spinner that reads `refreshing` over a blank cell is the wrong spinner.
    if (node.hasValue && node.value !== undefined) track.refreshing.write(true)
    else track.pending.write(true)

    // `Promise.resolve` of a native promise is that same promise, so the common case adds no tick;
    // it is here to make a foreign thenable safe to adopt.
    Promise.resolve(promise).then(
        (value) => {
            if (generation === track.generation) settleValue(node, value)
        },
        (error: unknown) => {
            if (generation === track.generation) settleError(node, error)
        },
    )
}

// A failure changes the OUTCOME of a plain read without moving the value, so the value's own
// readers have to be woken for it. Subscribing them to the error node instead does not work: a
// reader that ran before the cell ever met a promise subscribed when there was no error node to
// subscribe TO, and would then sit on the last good value as though the load had succeeded.
function wakeReaders(node: Node): void {
    for (const observer of node.observers) observer.mark(DIRTY)
}

function settleValue(node: Node, value: unknown): void {
    if (node.status === DEAD) return
    const track = trackerFor(node)
    const recovered = track.error.value !== undefined
    node.hasValue = true
    node.write(value) // identity-deduped: a re-fill of unchanged data wakes nobody
    if (recovered) wakeReaders(node) // …unless it is what stops the read throwing
    track.error.write(undefined)
    track.pending.write(false)
    track.refreshing.write(false)
    track.settled.write(true)
    finish(track, value, false)
}

// A failed load makes the READ throw — a caller that ignores it is not handling it. The retained
// value is not destroyed, though: `peek()` still serves it, which is the escape hatch for a UI that
// wants to keep showing stale data next to the error.
//
// A rejection reason of `undefined` is indistinguishable from "no error" in the error node's
// identity check, so it would settle without waking anyone. A marker keeps the wake honest.
const REJECTED_WITH_UNDEFINED = new Error('abide: the load rejected with undefined')

function settleError(node: Node, error: unknown): void {
    if (node.status === DEAD) return
    const track = trackerFor(node)
    const reason = error === undefined ? REJECTED_WITH_UNDEFINED : error
    // A second failure with the very same reason changes nothing a reader can observe.
    const changed = track.error.value !== reason
    track.error.write(reason)
    if (changed) wakeReaders(node)
    track.pending.write(false)
    track.refreshing.write(false)
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

// THE read. A failed load throws here rather than reporting `undefined` and letting a caller who
// never checked `error()` render as though nothing went wrong. The failure is read untracked — the
// subscription is to the value, and `settleError`/`settleValue` wake those readers on a flip.
// A cell that has never met a promise has no tracker and pays one null check for all of this.
function readCell(node: Node): unknown {
    const value = node.read()
    const track = node.asyncTrack
    if (track !== null && track.error.value !== undefined) throw track.error.value
    return value
}

// Backing for `then`: the promise of the SETTLED value. Reads untracked — awaiting a cell inside an
// effect must not subscribe the effect to it, since nothing can be tracked through an await anyway.
function settledPromise(node: Node): Promise<unknown> {
    if (node.fn !== null) node.pull() // awaiting an async memo starts its load
    const track = node.asyncTrack
    if (track === null) return Promise.resolve(node.value)
    if (track.pending.value === true || track.refreshing.value === true) {
        return new Promise((resolve, reject) => {
            if (track.waiters === null) track.waiters = []
            track.waiters.push({ resolve, reject })
        })
    }
    if (track.error.value !== undefined) return Promise.reject(track.error.value)
    return Promise.resolve(node.value)
}

function attachAsync(read: Cell<unknown>, node: Node): void {
    // Written on every cell, so the shape stays monomorphic and `nodeOf` never misses.
    ;(read as unknown as Record<symbol, Node>)[CELL] = node
    read.pending = () => trackerFor(node).pending.read() as boolean
    read.refreshing = () => trackerFor(node).refreshing.read() as boolean
    read.settled = () => trackerFor(node).settled.read() as boolean
    read.error = () => trackerFor(node).error.read()
    // Cast because `then` is generic in its two result types and this one implementation serves
    // every instantiation — the erased signature is the honest description of it.
    const target = read as unknown as {
        then: (onFulfilled?: unknown, onRejected?: unknown) => Promise<unknown>
    }
    target.then = (onFulfilled, onRejected) =>
        settledPromise(node).then(onFulfilled as never, onRejected as never)
}

// --- the seam a keyed `memo` slot sits on -----------------------------------
//
// A keyed slot IS a cell, so "a promise is a load" has ONE implementation rather than two that have
// to be kept in agreement. These are the operations a slot needs beyond the public surface, and
// every one is UNTRACKED on purpose: a slot's own bookkeeping — is a load in flight, subscribe me to
// the value — must not subscribe whoever triggered it, or a reader of the slot would wake on
// transitions it never asked about. Deliberately not re-exported from `$shared/index.ts`.

// Where a cell keeps its node. Graph-internal and deliberately NOT the brand a renderer checks: the
// brand answers "should a slot read this?", which is a wider question than "does this have a node"
// — a channel has no node and is still a source. `$shared/internal/BRANDS.ts` owns that one.
const CELL = Symbol.for('abide.cell')

function nodeOf(cell: Cell<unknown>): Node {
    return (cell as unknown as Record<symbol, Node>)[CELL] as Node
}

export const internals = {
    /**
     * A cell that has NOT settled: `undefined` is what it holds, not what it loaded. `beforeRead`
     * fires on `()` and on `await`, and on no other member — so a slot kicks its own load from the
     * read while `peek` and the probes still start nothing.
     */
    cold<T>(beforeRead: () => void): State<T | undefined> {
        return makeCell(new Node(undefined, null), beforeRead) as State<T | undefined>
    },
    /** A derivation whose read runs `beforeRead` first — how an argless memo applies its ttl. */
    derived<T>(fn: () => unknown, beforeRead: () => void): Memo<T> {
        return makeDerived(fn, beforeRead) as Memo<T>
    },
    loading<T>(cell: Cell<T>): boolean {
        const track = nodeOf(cell as Cell<unknown>).asyncTrack
        return track !== null && (track.pending.value === true || track.refreshing.value === true)
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
        track.error.write(undefined)
        track.pending.write(false)
        track.refreshing.write(false)
        track.settled.write(false)
        if (wasFailed) wakeReaders(node)
        if (track.waiters !== null) {
            finish(track, new Error('abide: invalidated before the load settled'), true)
        }
    }
    node.hasValue = false
    node.write(undefined)
}

// --- the surface ----------------------------------------------------------

// The vocabulary is abide's, not the textbook one: `state` (own) / `memo` (derive) / `watch`
// (react). `signal` is deliberately not a name here — abide retired it to avoid colliding with the
// TC39 Signals proposal, and a cell is CALLABLE (`x()` read, `x.set(v)` write, `x.peek()` untracked)
// rather than an object with `.value`.
//
// Every cell carries the same async surface, and a purely sync cell answers it honestly: `settled()`
// true, `pending()` false, `error()` undefined, `await x` already resolved.
//
// One surface, uniformly: reads (`()`, `peek`), probes (`pending`/`refreshing`/`error`/`settled`),
// and the two verbs that need no body — `set` (this IS the value) and `invalidate` (this is WRONG).
// `refresh` is the one verb that is NOT here, because re-running requires a body to re-run; it lives
// on `Memo` and on a keyed handle. `dispose` likewise: only a derivation owns subscriptions.
export interface Cell<T> extends PromiseLike<T> {
    /** The value. THROWS if the last load failed — a caller that ignores it is not handling it. */
    (): T
    /** The retained value, subscribing to nothing and never throwing. The escape hatch. */
    peek(): T
    /** Write it directly. A promise here is a LOAD; anything else settles the cell in the call. */
    set(value: T | Promise<T>): void
    /** Drop the value and any error, cancel what is in flight, and go back to cold. */
    invalidate(): void
    /** A cold load is in flight — nothing retained to show. */
    pending(): boolean
    /** A load is in flight OVER a retained value. Its own signal; never wakes value readers. */
    refreshing(): boolean
    /** The last load's rejection, or `undefined`. Probes never throw. */
    error(): unknown
    /** Has a value or an error ever landed? */
    settled(): boolean
    /** Narrowed from `PromiseLike` to a real promise — `await x`, and `.catch` on the result. */
    then<Fulfilled = T, Rejected = never>(
        onFulfilled?: ((value: T) => Fulfilled | PromiseLike<Fulfilled>) | null,
        onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
    ): Promise<Fulfilled | Rejected>
}

/** A cell you own outright. Nothing beyond `Cell` — owning one is what `state` means. */
export type State<T> = Cell<T>

export interface Memo<T> extends Cell<T> {
    /** Re-run the body NOW, keeping the current value served until the new one lands. */
    refresh(): void
    dispose(): void
}

// `beforeRead` runs on the two operations that ASK FOR THE VALUE — `x()` and `await x` — and on
// nothing else. That is the seam a keyed slot kicks its load through: selecting a slot starts
// nothing, reading it does, and a probe on the same handle still causes nothing at all.
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
        if (isThenable(value)) {
            adopt(node, value)
            return
        }
        const track = node.asyncTrack
        // A sync write is the newer answer: it CANCELS whatever is in flight.
        if (track !== null) {
            track.generation++
            settleValue(node, value)
        } else {
            node.hasValue = true
            node.write(value)
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
    attachAsync(read, node)
    if (beforeRead !== null) {
        const settled = read.then.bind(read) as (a?: unknown, b?: unknown) => Promise<unknown>
        const target = read as unknown as {
            then: (a?: unknown, b?: unknown) => Promise<unknown>
        }
        target.then = (onFulfilled, onRejected) => {
            beforeRead() // awaiting a cold slot must start it, or it resolves `undefined` forever
            return settled(onFulfilled, onRejected)
        }
    }
    return read
}

export function state<T>(initial: Promise<T>): State<T | undefined>
export function state<T>(initial: T): State<T>
// biome-ignore lint/suspicious/noExplicitAny: the overloads above ARE the public type; unifying them in the implementation signature would widen the two return types the overloads exist to keep apart.
export function state(initial: unknown): any {
    const node = new Node(undefined, null)
    if (isThenable(initial)) {
        adopt(node, initial)
    } else {
        node.value = initial
        node.hasValue = true
    }
    return makeCell(node, null)
}

// The ARGLESS form of abide's `memo`: auto-tracked derivation, lazy, memoised on identity. A body
// that returns a promise becomes a load — its dependencies are the ones read BEFORE the first
// `await`, which is everything tracking can honestly see. Args-keyed memoisation lives in `memo.ts`.
export function derive<T>(fn: () => Promise<T>): Memo<T | undefined>
export function derive<T>(fn: () => T): Memo<T>
// biome-ignore lint/suspicious/noExplicitAny: the overloads above ARE the public type; unifying them in the implementation signature would widen the two return types the overloads exist to keep apart.
export function derive(fn: () => unknown): any {
    return makeDerived(fn, null)
}

function makeDerived(fn: () => unknown, beforeRead: (() => void) | null): Memo<unknown> {
    const node = new Node(undefined, fn)
    const read = makeCell(node, beforeRead) as Memo<unknown>
    // Re-run NOW. A load started by the body reports `refreshing` over the retained value, so the
    // old one keeps being served — the same shape a keyed slot's refresh has.
    read.refresh = () => {
        node.status = DIRTY
        node.pull()
    }
    // Dropping the value is not enough on a derivation: without re-marking it, the node is CLEAN and
    // holding `undefined`, so nothing would ever recompute it until a dependency happened to move.
    read.invalidate = () => {
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
// biome-ignore lint/suspicious/noConfusingVoidType: the union IS the contract — an effect either returns nothing or returns its teardown, and that is the whole lifecycle story.
export function watch(fn: () => void | (() => void)): () => void {
    const node = new Node(undefined, fn as () => unknown, true)
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
    if (collecting !== null) collecting.push(() => node.dispose())
    return node
}

/** Run an effect node NOW, as `pull` would. Its sources are re-collected, so a new body is adopted. */
export function rerun(node: Node): void {
    if (node.status === DEAD) return
    node.run()
    node.status = CLEAN
}

export function untrack<T>(fn: () => T): T {
    const previous = current
    current = null
    try {
        return fn()
    } finally {
        current = previous
    }
}

// `untrack(() => binder(value))` with the argument threaded through instead of captured.
//
// The closure is the cost: a template slot writes its value untracked on every patch, so the
// captured form allocates one closure per slot per row per update — on a thousand-row list that is a
// thousand allocations to make a call the engine could have made directly. Internal, because the
// argless `untrack` is the spelling authors want and this one only pays off in a loop.
export function untrackCall<A>(fn: (arg: A) => void, arg: A): void {
    const previous = current
    current = null
    try {
        fn(arg)
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
