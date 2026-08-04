// Fine-grained reactivity substrate (rpc-core §7).
// Push-notify + pull-recompute, microtask-batched, glitch-free (topological).
// Reading a `state` in a tracking context subscribes; writes stale-propagate; computeds are lazy +
// memoized; effects re-run on a batched microtask flush and support a teardown return value.
//
// `state` is THE atom (ADR 0023) — `memo` and `channel` store their value in one. The name `signal` is
// retired here so nothing in abide collides with the future TC39 `Signal`.

import { reactiveScope } from './reactiveScope.ts'

// Node statuses. Ordered so higher = more stale; DISPOSED is terminal above DIRTY.
const CLEAN = 0
const CHECK = 1
const DIRTY = 2
const DISPOSED = 3

// The reaction currently executing (computed/effect). Reads register against it.
let currentObserver: Reactive | null = null
// Sources read during the current run, collected in read order. `null` while the
// fast-path (reuse of the previous run's source list) still holds.
let currentSources: Reactive[] | null = null
let currentSourcesIndex = 0

// Effects awaiting a flush. Deduped by state transitions (an effect is enqueued only on
// the CLEAN -> stale edge).
let effectQueue: Reactive[] = []
let flushScheduled = false

class Reactive {
    value: unknown
    fn: (() => unknown) | null
    status: number
    isEffect: boolean
    // Graph edges. `sources` = nodes we read; `observers` = nodes that read us.
    sources: Reactive[] | null
    observers: Reactive[] | null
    // Effect teardown returned from the last run.
    cleanup: (() => void) | null

    // `derived` distinguishes computed/effect nodes (have `fn`) from state nodes (hold a
    // value). It is passed explicitly so a state may legitimately hold a function value.
    constructor(payload: unknown, derived: boolean, isEffect: boolean) {
        this.isEffect = isEffect
        this.sources = null
        this.observers = null
        this.cleanup = null
        if (derived) {
            // Derived node (computed/effect): starts DIRTY, recomputed lazily on read/flush.
            this.fn = payload as () => unknown
            this.value = undefined
            this.status = DIRTY
        } else {
            // Source node (state): holds a value, always CLEAN.
            this.fn = null
            this.value = payload
            this.status = CLEAN
        }
    }

    get(): unknown {
        if (currentObserver !== null) {
            // Track this read against the running reaction. Fast-path: if we still match the
            // previous run's source list at the current index, just advance.
            if (
                currentSources === null &&
                currentObserver.sources !== null &&
                currentObserver.sources[currentSourcesIndex] === this
            ) {
                currentSourcesIndex++
            } else if (currentSources === null) {
                currentSources = [this]
            } else {
                currentSources.push(this)
            }
        }
        if (this.fn !== null) this.updateIfNecessary()
        return this.value
    }

    // Untracked read that still pulls a fresh value for derived nodes.
    peekValue(): unknown {
        if (this.fn !== null) this.updateIfNecessary()
        return this.value
    }

    set(next: unknown): void {
        if (this.value === next) return
        this.value = next
        const observers = this.observers
        if (observers !== null) {
            for (const observer of observers) observer.stale(DIRTY)
        }
    }

    // Mark this node (and, transitively, its observers) potentially out of date.
    // Direct dependents of a changed source go DIRTY; deeper dependents go CHECK and only
    // recompute if a source actually changes (glitch-free pull).
    stale(nextStatus: number): void {
        if (this.status >= nextStatus) return
        if (this.status === CLEAN && this.isEffect) {
            effectQueue.push(this)
            scheduleFlush()
        }
        this.status = nextStatus
        const observers = this.observers
        if (observers !== null) {
            for (const observer of observers) observer.stale(CHECK)
        }
    }

    updateIfNecessary(): void {
        if (this.status === CLEAN || this.status === DISPOSED) return
        if (this.status === CHECK) {
            // Resolve each source; a source that actually changes flips us to DIRTY.
            const sources = this.sources
            if (sources !== null) {
                for (const source of sources) {
                    source.updateIfNecessary()
                    if ((this.status as number) === DIRTY) break
                }
            }
        }
        if (this.status === DIRTY) this.update()
        this.status = CLEAN
    }

    update(): void {
        const prevObserver = currentObserver
        const prevSources = currentSources
        const prevIndex = currentSourcesIndex
        currentObserver = this
        currentSources = null
        currentSourcesIndex = 0

        // Run teardown before re-running the effect body.
        if (this.isEffect && this.cleanup !== null) {
            const teardown = this.cleanup
            this.cleanup = null
            teardown()
        }

        const fn = this.fn
        if (fn === null) throw new Error('update() ran on a source node without a compute fn')
        const oldValue = this.value
        let value: unknown
        let threw = false
        let error: unknown
        try {
            value = fn()
        } catch (caught) {
            threw = true
            error = caught
            value = undefined
        }

        reconcileSources(this)
        currentObserver = prevObserver
        currentSources = prevSources
        currentSourcesIndex = prevIndex

        if (threw) throw error

        if (this.isEffect) {
            this.cleanup = typeof value === 'function' ? (value as () => void) : null
            // effects hold no value and have no observers to notify
            return
        }

        // Memoize: only propagate when the derived value actually changed.
        if (oldValue !== value) {
            const observers = this.observers
            if (observers !== null) {
                for (const observer of observers) observer.status = DIRTY
            }
        }
        this.value = value
    }
}

// Rebuild this node's source subscriptions from the reads collected during its run.
function reconcileSources(node: Reactive): void {
    if (currentSources !== null) {
        // Drop stale tail (sources beyond the reused prefix) then append the new reads.
        removeSourceObservers(node, currentSourcesIndex)
        if (node.sources !== null && currentSourcesIndex > 0) {
            node.sources.length = currentSourcesIndex + currentSources.length
            // Indexed, not `.entries()`: this is the per-re-run resubscription path, and the iterator
            // allocated a `[i, source]` tuple for every source read during the run.
            for (let i = 0; i < currentSources.length; i++) {
                node.sources[currentSourcesIndex + i] = currentSources[i] as Reactive
            }
        } else {
            node.sources = currentSources
        }
        for (let i = currentSourcesIndex; i < node.sources.length; i++) {
            const source = node.sources[i]
            if (source === undefined) continue
            if (source.observers === null) source.observers = [node]
            else source.observers.push(node)
        }
    } else if (node.sources !== null && currentSourcesIndex < node.sources.length) {
        // Fewer reads than last run: trim the unused tail.
        removeSourceObservers(node, currentSourcesIndex)
        node.sources.length = currentSourcesIndex
    }
}

// Detach `node` from the observer lists of its sources at indices >= index.
function removeSourceObservers(node: Reactive, index: number): void {
    const sources = node.sources
    if (sources === null) return
    for (let i = index; i < sources.length; i++) {
        const source = sources[i]
        if (source === undefined) continue
        const observers = source.observers
        if (observers === null) continue
        const at = observers.indexOf(node)
        if (at >= 0) {
            const last = observers[observers.length - 1]
            if (last === undefined)
                throw new Error('observers unexpectedly empty during swap-remove')
            observers[at] = last
            observers.pop()
        }
    }
}

function scheduleFlush(): void {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(flush)
}

function flush(): void {
    flushScheduled = false
    // Process until the queue drains, since effects may schedule further work.
    while (effectQueue.length > 0) {
        const batchOfEffects = effectQueue
        effectQueue = []
        for (const node of batchOfEffects) {
            if (node.status !== DISPOSED) node.updateIfNecessary()
        }
    }
}

function disposeNode(node: Reactive): void {
    if (node.status === DISPOSED) return
    if (node.cleanup !== null) {
        const teardown = node.cleanup
        node.cleanup = null
        teardown()
    }
    removeSourceObservers(node, 0)
    node.sources = null
    node.observers = null
    node.status = DISPOSED
}

// The ATOM. `state` is the one reactive source node (ADR 0023): calling it in a tracking context
// subscribes, `set` publishes, `peek` reads WITHOUT subscribing. The public `shared/state.ts` is
// this same shape plus the `.abide` compiler brand and the `.shared` factory — not a second kind of cell.
//
// NAMED `peek`, on all three primitives, meaning one thing: read what is there, subscribe to nothing,
// acquire nothing. This member spent a while called `untracked` (ADR 0027 D2) for a reason that no longer
// exists — `peek` then meant the OPPOSITE on `memo`/`channel` (it subscribed and kicked a load), and one
// word could not mean both on the axis the whole reactive model is built on. D2 resolved that collision by
// moving the rare member; splitting the memo's two reads into `live` (subscribes + acquires) and `peek`
// (neither) resolved it at the source instead, which left `untracked` as a second name for an operation
// that already had one. `state.peek()` is exactly `untrack(() => cell())`, and now also exactly what
// `memo.peek()` / `channel.peek()` / `socket.peek()` do.
//
// `untrack(fn)` — the REGION wrapper, further down this file — keeps its name. It is a different thing:
// this reads one cell, that runs arbitrary work with tracking suspended.
export interface State<T> {
    (): T
    set(value: T): void
    peek(): T
}

export interface Computed<T> {
    (): T
    peek(): T
    // Detach the node from its sources. `memo`'s auto-tracked fill (ADR 0024 §2) can only tell a
    // synchronous derivation from a promise/stream source by RUNNING the body once inside a computed;
    // when the run turns out to be deferred it drops the node, and without this the discarded node would
    // stay in its sources' observer lists forever (one dead edge per request on the server).
    dispose(): void
}

export function state<T>(initial: T): State<T> {
    const node = new Reactive(initial, false, false)
    const read = (() => node.get() as T) as State<T>
    read.set = (value: T) => node.set(value)
    read.peek = () => node.value as T
    return read
}

export function computed<T>(fn: () => T): Computed<T> {
    const node = new Reactive(fn, true, false)
    const read = (() => node.get() as T) as Computed<T>
    read.peek = () => node.peekValue() as T
    read.dispose = () => disposeNode(node)
    return read
}

// EFFECT OWNERSHIP. While a scope is open, every effect created inside it also hands its disposer to
// that scope, so a caller can tear down a whole batch of effects it did not itself create. That is what
// makes a component's `<script>` effects die with the component: `mount`/`render` open a scope around
// the setup preamble, and disposing it kills what the scope collected. There is no `onDestroy` in the
// template grammar (§C4.5) — a `watch` teardown IS the cleanup hook, and it only holds if something
// reaches these effects when the component goes away (unmount on the client, end of request on the
// server).
//
// The stack lives on the AMBIENT CONTEXT, not on a module global, because a server `render` is async
// and requests interleave: a process-wide stack would attribute request A's effects to request B when
// A resumes from an `await` in its setup. One stack per context — which on the server is one per
// request (AsyncLocalStorage) and on the client is the single session context — makes cross-request
// attribution unrepresentable. `openScopeCount` is only a fast path so an effect created while NO
// scope is open anywhere (template wiring, memo internals — the hot path) skips the context lookup.
//
// A scope carries the stack it was pushed onto, so closing and disposing NEVER re-derive the ambient
// context. Only attribution (which scope an effect joins) is ambient; a close that ran under a
// different context than its open would otherwise silently no-op and strand the scope open.
export interface EffectScope {
    disposers: Array<() => void>
    stack: EffectScope[]
}

let openScopeCount = 0

export function openEffectScope(): EffectScope {
    const context = reactiveScope()
    if (context.effectScopes === undefined) context.effectScopes = []
    const stack = context.effectScopes
    const scope: EffectScope = { disposers: [], stack }
    stack.push(scope)
    openScopeCount++
    return scope
}

// Idempotent, and pops any scope opened INSIDE this one — a setup preamble that throws must not strand
// an open scope that then swallows the next mount's effects.
export function closeEffectScope(scope: EffectScope): void {
    const stack = scope.stack
    const index = stack.lastIndexOf(scope)
    if (index === -1) return
    openScopeCount -= stack.length - index
    stack.length = index
}

export function disposeEffectScope(scope: EffectScope): void {
    for (const dispose of scope.disposers) dispose()
    scope.disposers.length = 0
}

// Register a teardown on the INNERMOST open effect scope — a component's setup preamble on the client,
// a render's on the server. Returns false when no scope is open, which is the caller's signal that it
// owns the lifetime itself (a module-level construction lives for the process).
export function onEffectScopeDispose(dispose: () => void): boolean {
    if (openScopeCount === 0) return false
    const stack = reactiveScope().effectScopes
    const scope = stack === undefined ? undefined : stack[stack.length - 1]
    if (scope === undefined) return false
    scope.disposers.push(dispose)
    return true
}

// biome-ignore lint/suspicious/noConfusingVoidType: void (not undefined) lets callers pass a void-returning thunk (e.g. watch.ts) whose value is ignored; undefined would break assignability
export function effect(fn: () => void | (() => void)): () => void {
    const node = new Reactive(fn, true, true)
    node.updateIfNecessary() // runs synchronously to establish subscriptions
    const dispose = () => disposeNode(node)
    onEffectScopeDispose(dispose)
    return dispose
}

export function untrack<T>(fn: () => T): T {
    const prevObserver = currentObserver
    currentObserver = null
    try {
        return fn()
    } finally {
        currentObserver = prevObserver
    }
}
