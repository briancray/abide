// `memo` — the memoizer. One name, two forms, split by whether the body DECLARES INPUTS:
//
//   memo(() => a() + b())        no args -> dependencies are inferred from the body (tracked)
//   memo(({ id }) => fetch(id))  args    -> the args ARE the cache key, one slot per key
//
// That is abide's rule verbatim, and it is why there is no second name for "async memo": the load
// path and the derive path are the same concept with different dependency declarations.
//
// A keyed slot IS a cell. "A promise is a load" — retain across a re-load, cold `pending` vs warm
// `refreshing`, newest-write-wins, throw from the read — is implemented once, in the engine, and
// this file is the cache around it: one slot per args key, a ttl, and the eager/lazy verbs. When the
// two had separate implementations they drifted twice (what a retained `undefined` counts as, and
// whether a retry after an error keeps throwing), which is the argument against ever splitting them.
//
// EITHER form takes a sync or an async body and neither is a different spelling. A sync body settles
// IN THE CALL — no pending flash, no microtask before the first read sees it — because the promise
// wrapper is the fallback here, not the default.
//
// Probes observe; they never cause — which is why the READ kicks the load and the CALL does not.
// Selecting a slot that starts work would leave no way to ask anything about a key without starting
// work on it, and `peek`/`pending` on a cold slot would stop being questions. The two members that
// ask for the value, `()` and `await`, are the two that start one.

import { markSource } from './internal/BRANDS.ts'
import { admit, Bounded, release, touch } from './internal/ceilings.ts'
import { derive, internals, type Memo, type State, untrack } from './internal/graph.ts'
import { keyOf, matcher } from './internal/keys.ts'
import { isAsyncIterable, isThenable } from './internal/probes.ts'
import { disposeWith, storeFor } from './internal/scopes.ts'
import { byTag, joinTags } from './internal/tags.ts'
import { arm } from './internal/timers.ts'

export type { Memo }

// The handle a keyed call hands back: the slot's own cell, plus the two verbs that need a body to
// re-run. Everything else — `()`, `peek`, `set`, the probes, `await` — is the ordinary cell surface,
// which is why there is no `live`/`peek(args)`/`publish(args, v)` vocabulary here any more. The args
// select the slot ONCE, at the call.
export interface MemoHandle<T> extends State<T | undefined> {
    /** This data may be STALE: re-run the body now, keeping the old value on screen meanwhile. */
    refresh(): void
    /**
     * Awaiting waits for a settle, so it resolves the loaded type — narrower than `()`, which may
     * find nothing there yet.
     */
    then<Fulfilled = T, Rejected = never>(
        onFulfilled?: ((value: T) => Fulfilled | PromiseLike<Fulfilled>) | null,
        onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
    ): Promise<Fulfilled | Rejected>
}

interface Slot<T> {
    handle: MemoHandle<T>
    /** When the slot last settled. 0 is never — cold, so the next read runs the body. */
    loadedAt: number
    /**
     * The slot's entry in the process-wide LRU, or `null` when nothing bounds it.
     *
     * Non-null only for a slot living in the PROCESS cache — a `{ global }` memo's, or one filled
     * where there was no caller scope. A per-caller slot is already bounded by the request that owns
     * it, so the field is the null check that keeps the ceiling off a server's hot path entirely.
     */
    bounded: Bounded | null
}

export interface KeyedMemo<Args, T> {
    /** Selects the slot. The handle is where everything else lives; the READ is what kicks a load. */
    (args: Args): MemoHandle<T>
    /**
     * Every slot MATCHING the pattern — a subset of the args, compared the same way slots are keyed.
     * No pattern means every slot. Exactly one slot is `m(args).invalidate()`, which is why this one
     * is free to mean "match" without the two spellings ever being confused.
     */
    invalidate(pattern?: Partial<Args>): void
    refresh(pattern?: Partial<Args>): void
}

export interface MemoOptions<Args = unknown> {
    /** ms a settled slot is served before the next read runs cold. Default: forever. */
    ttl?: number
    /**
     * One cache shared by every caller, regardless of which request or process asked.
     *
     * Off by default, and that default is the whole point: a module-level memo is created once, at
     * import, so on a server its cache outlives the request that filled it. Serving the next caller
     * what the last one loaded is not a stale cache, it is the wrong person's data. Turn this on for
     * what genuinely belongs to the process — a config file, a currency table, anything whose answer
     * does not depend on who asked.
     */
    global?: boolean
    /**
     * Names this joins, so `invalidate({ tags })` can reach it without knowing what it is. A
     * function receives the slot's args, which is how a tag names one ROW (`user:42`) rather than
     * every row a memo holds.
     */
    tags?: string[] | ((args: Args) => string[])
    /**
     * ms. Explicit revalidation of a slot that already holds a value fires immediately, then at most
     * once per window — a burst of `refresh` calls is one run now and one at the end of the window.
     */
    throttle?: number
    /**
     * ms. Explicit revalidation of a slot that already holds a value waits until the triggers stop.
     * Set with `throttle`, this wins — the two are answers to the same question.
     */
    debounce?: number
}

/**
 * The `throttle` / `debounce` window, per slot.
 *
 * COLD is never paced: a slot with nothing retained has nothing on screen for a window to protect,
 * so its first load runs in the call. That is also why this sits on `refresh` alone — the read-driven
 * load of a cold slot never comes through here.
 */
function pacer(
    throttleMs: number,
    debounceMs: number,
): { fire(warm: boolean, run: () => void): void; cancel(): void } {
    let timer: ReturnType<typeof setTimeout> | null = null
    let firedAt = 0
    return {
        fire(warm, run) {
            if (!warm) {
                run()
                return
            }
            if (debounceMs > 0) {
                if (timer !== null) clearTimeout(timer)
                timer = arm(() => {
                    timer = null
                    run()
                }, debounceMs)
                return
            }
            const since = Date.now() - firedAt
            if (since >= throttleMs) {
                firedAt = Date.now()
                run()
                return
            }
            if (timer !== null) return // the tail of this window is already claimed
            timer = arm(() => {
                timer = null
                firedAt = Date.now()
                run()
            }, throttleMs - since)
        },
        cancel() {
            if (timer === null) return
            clearTimeout(timer)
            timer = null
        },
    }
}

export interface TagSelector {
    tags: string[]
}

/** Everything carrying any of these tags. `scope` narrows it to one memo's slots. */
export function invalidate(selector: TagSelector, scope?: unknown): void {
    byTag(selector.tags, scope, 'invalidate')
}
export function refresh(selector: TagSelector, scope?: unknown): void {
    byTag(selector.tags, scope, 'refresh')
}

function keyedMemo<Args, T>(
    body: (args: Args) => T | Promise<T>,
    options: MemoOptions<Args>,
    transform?: (value: unknown) => unknown,
): KeyedMemo<Args, T> {
    const ttl = options.ttl ?? Infinity
    const throttleMs = options.throttle ?? 0
    const debounceMs = options.debounce ?? 0
    const paced = throttleMs > 0 || debounceMs > 0
    const tags = options.tags
    const shared = new Map<string, { slot: Slot<T>; args: Args }>()
    const isGlobal = options.global === true

    // Which cache this caller reads. `shared` is the one every caller uses when there is no caller
    // scope — a client, a script, a test — so the client pays one null check and no lookup.
    const makeCache = (): Map<string, { slot: Slot<T>; args: Args }> => new Map()
    function cache(): Map<string, { slot: Slot<T>; args: Args }> {
        if (isGlobal) return shared
        return storeFor(call, makeCache, shared)
    }

    function slotFor(args: Args): Slot<T> {
        const slots = cache()
        const key = keyOf(args)
        const entry = slots.get(key)
        if (entry !== undefined) {
            // The SELECT is the recency signal, because it is the one thing every access to a slot
            // goes through — a read, a peek and a probe alike all start at `m(args)`.
            const bound = entry.slot.bounded
            if (bound !== null) touch(bound)
            return entry.slot
        }

        // COLD, not `state(undefined)`: the slot holds nothing, it has not loaded nothing. The read
        // is what kicks it — selecting the slot, peeking at it or probing it starts nothing.
        const slot: Slot<T> = {
            handle: undefined as unknown as MemoHandle<T>,
            loadedAt: 0,
            bounded: null,
        }
        const handle = internals.cold<T>(() => {
            if (stale(slot) && !internals.loading(handle)) start(args, slot)
        }, transform) as MemoHandle<T>
        slot.handle = handle

        // Everything below is bound ONCE per slot, not per call.
        const write = handle.set
        handle.set = (value) => {
            // A local write settles the slot, so it must not read as stale — otherwise the next
            // read would kick a load that immediately overwrites what was just written.
            slot.loadedAt = Date.now()
            write(value)
            // A promise here is a LOAD, so the charge waits for what lands — `start` makes it. An
            // async iterable is a STREAM, and a stream is never charged here at all: what it retains
            // is the transcript, which has a ceiling of its own, and charging the latest chunk would
            // put a cache measurement inside a hot loop.
            const bound = slot.bounded
            if (bound !== null && !isThenable(value) && !isAsyncIterable(value)) admit(bound, value)
        }
        const drop = handle.invalidate
        const window = paced ? pacer(throttleMs, debounceMs) : null
        handle.invalidate = () => {
            // A queued revalidation of data now declared WRONG is a load nobody wants: `invalidate`
            // starts nothing, and that has to include what a window was about to start.
            window?.cancel()
            slot.loadedAt = 0
            // Cold holds nothing, so it is charged nothing — and a slot charged nothing is one the
            // ceiling has no reason to evict ahead of something that is actually occupying it.
            if (slot.bounded !== null) release(slot.bounded)
            drop()
        }
        handle.refresh =
            window === null
                ? () => start(args, slot)
                : () => window.fire(slot.loadedAt !== 0, () => start(args, slot))
        // A window armed inside one request must not fire inside the next: a per-caller slot goes
        // away with its caller, and the timer holding it has to go with it.
        if (window !== null && !isGlobal) disposeWith(() => window.cancel())

        // Tags are resolved per SLOT, so `tags: ({id}) => ['user:' + id]` names one row rather than
        // every row this memo holds.
        let leave: (() => void) | null = null
        if (tags !== undefined) {
            leave = joinTags(typeof tags === 'function' ? tags(args) : tags, {
                owner: call,
                target: handle,
            })
            // A per-caller slot must leave the registry with its caller, or the module-level map
            // grows by one entry per request forever.
            if (!isGlobal) disposeWith(leave)
        }

        // Only the PROCESS cache is bounded — `{ global }`'s map, and the one every caller shares
        // where there is no caller scope. Those are the two that outlive whoever filled them.
        if (slots === shared) {
            slot.bounded = new Bounded(slots as Map<string, unknown>, key, leave)
        }

        slots.set(key, { args, slot })
        return slot
    }

    const stale = (slot: Slot<T>): boolean =>
        slot.loadedAt === 0 || (ttl !== Infinity && Date.now() - slot.loadedAt >= ttl)

    // Run the body into the slot. Returns nothing: a caller that wants the outcome asks the handle,
    // never the body's own promise. That is what makes coalescing, newest-wins and "invalidate
    // mid-load tells the awaiters" true for `await m(args)` too.
    function start(args: Args, slot: Slot<T>): void {
        let produced: T | Promise<T>
        try {
            produced = untrack(() => body(args))
        } catch (error) {
            // A body that throws synchronously settles in the call, exactly as a sync value does.
            slot.loadedAt = Date.now()
            internals.fail(slot.handle, error)
            return
        }
        // A sync body must never be observable as a load: wrapping it in `Promise.resolve().then()`
        // costs a microtask tick and makes the slot flash `pending` for data already in hand.
        if (!isThenable(produced)) {
            // Not stamped here: `handle.set` is overridden per slot and stamps as its first
            // statement, so a second `Date.now()` on this line is the same write twice and a second
            // writer of one field for the next reader to reconcile.
            slot.handle.set(produced)
            return
        }
        // Stamped BEFORE the cell settles, so a reader woken by the settle cannot see the slot stale
        // and kick a second load. Handing the cell the raw promise would leave that a race.
        const stamped = produced.then(
            (value) => {
                slot.loadedAt = Date.now()
                // Charged where it LANDS. A rejection charges nothing and releases nothing: a warm
                // slot whose refresh failed is still serving what it holds, so the cache is still
                // holding it.
                if (slot.bounded !== null) admit(slot.bounded, value)
                return value
            },
            (error: unknown) => {
                slot.loadedAt = Date.now()
                throw error
            },
        )
        // The cell does the rest: cold → `pending`, warm → `refreshing` over the retained value,
        // and a stale settle discarded if a newer load overtakes this one.
        slot.handle.set(stamped)
    }

    // The call SELECTS a slot. It does not read it, so it neither subscribes, throws, nor loads —
    // the handle's read does all three. That is what keeps `m(args).peek()` a question, not a cause.
    const call = ((args: Args) => slotFor(args).handle) as KeyedMemo<Args, T>

    // Bulk verbs walk the slots that EXIST — this caller's — and unlike `slotFor`, matching
    // materialises nothing.
    // The pattern is compiled once and asked per slot, rather than taken apart again for every one
    // of them: it is the same small object throughout the walk, and its keys are what cost.
    call.invalidate = (pattern?: Partial<Args>): void => {
        const wanted = matcher(pattern)
        for (const entry of cache().values()) {
            if (wanted(entry.args)) entry.slot.handle.invalidate()
        }
    }
    call.refresh = (pattern?: Partial<Args>): void => {
        const wanted = matcher(pattern)
        for (const entry of cache().values()) {
            if (wanted(entry.args)) entry.slot.handle.refresh()
        }
    }
    return call
}

// Argless: dependencies come from the body. An async body is fine and keeps tracking — the deps are
// the ones read BEFORE the first `await`, which is everything tracking can honestly see. Reading
// returns the retained value and kicks the load; when a dep moves, the body re-runs and the older
// load's result is discarded rather than landing on top of the newer one.
//
// It carries the SAME options as the keyed form — `ttl` and `tags` mean what they mean there.
function buildArgless<T>(
    body: () => T,
    options: MemoOptions,
    transform?: (value: unknown) => unknown,
): Memo<T> {
    const ttl = options.ttl ?? Infinity
    let loadedAt = 0

    // Stamped when the body SETTLES, not when it starts, so a ttl counts from the answer.
    const timed = (): unknown => {
        const produced = body()
        if (!isThenable(produced)) {
            loadedAt = Date.now()
            return produced
        }
        return produced.then(
            (value) => {
                loadedAt = Date.now()
                return value
            },
            (error: unknown) => {
                loadedAt = Date.now()
                throw error
            },
        )
    }

    const cell: Memo<T> =
        ttl === Infinity
            ? derive(timed as () => T, transform)
            : internals.derived<T>(
                  timed,
                  () => {
                      // Expired → recompute during THIS read, which is what "the next read runs cold"
                      // means when there is no args key to hang the staleness off.
                      //
                      // `loading` is not optional here: `loadedAt` is stamped when the body SETTLES, so
                      // every read between expiry and the answer landing would start another run — a
                      // thundering herd off a stale timestamp. The keyed path guards the same way.
                      if (loadedAt === 0 || internals.loading(cell)) return
                      if (Date.now() - loadedAt >= ttl) cell.refresh()
                  },
                  transform,
              )

    // The pacing is the keyed form's, one cell instead of one slot: it wraps the EXPLICIT verb, so a
    // ttl expiring on a read still recomputes in the call and only `refresh` waits for a window.
    // The same predicate the keyed form spells as `paced`: a window of zero is not a window, so
    // `{ throttle: 0 }` builds no pacer here either.
    if ((options.throttle ?? 0) > 0 || (options.debounce ?? 0) > 0) {
        const window = pacer(options.throttle ?? 0, options.debounce ?? 0)
        const run = cell.refresh
        cell.refresh = () => window.fire(loadedAt !== 0, run)
        const drop = cell.invalidate
        cell.invalidate = () => {
            window.cancel()
            drop()
        }
        if (options.global !== true) disposeWith(() => window.cancel())
    }

    if (options.tags !== undefined) {
        const names = typeof options.tags === 'function' ? options.tags(undefined) : options.tags
        const leave = joinTags(names, { owner: cell, target: cell })
        if (options.global !== true) disposeWith(leave)
    }
    return cell
}

// The argless form has no args key to hang a per-caller cache off, so the CELL itself is what varies
// — which means the thing handed back has to be a facade over "whichever cell belongs to the caller
// asking". The keyed form needs none of this: its cache is already a map, so scoping it is choosing a
// different map.
//
// The cost is one extra frame per member call, and it is paid only where a scope can exist. On a
// client `currentScope()` is a null check that always answers the same way, so the facade forwards
// straight to the module-level cell — see the `global` arm of the scope bench, which measures exactly
// this by comparing a facade read against the raw cell it wraps.
function scopedArgless<T>(fallback: Memo<T>, build: () => Memo<T>): Memo<T> {
    const make = (): Memo<T> => {
        const made = build()
        // A derivation subscribes to what it read, so a caller's instance has to be torn down with
        // the caller or its sources keep it alive.
        disposeWith(() => made.dispose())
        return made
    }
    const pick = (): Memo<T> => storeFor(pick, make, fallback)

    // Inlining `pick`'s null check into the read to save a frame was tried and made no difference
    // (5.3 vs 5.1 ns/op) — the engine already inlines it, so what the facade costs is the extra
    // CLOSURE CALL, not the depth. There is nothing to buy back short of not having a facade.
    const facade = markSource((() => pick()()) as Memo<T>)

    // A TABLE typed by `keyof Memo`, not one assignment per member: a member added to the cell surface is
    // then a type error HERE, rather than a member that is silently `undefined` on every scoped memo
    // — and only where a caller scope exists, so never in a client test.
    //
    // Deliberately no `abide.cell`: that symbol names ONE node, and the whole point of the facade is
    // that the node varies by caller. `internals` is handed the inner cell, never this.
    const forward: { [K in keyof Memo<T>]: Memo<T>[K] } = {
        peek: () => pick().peek(),
        set: (value) => pick().set(value),
        invalidate: () => pick().invalidate(),
        refresh: () => pick().refresh(),
        dispose: () => pick().dispose(),
        chunks: () => pick().chunks(),
        pending: () => pick().pending(),
        refreshing: () => pick().refreshing(),
        streaming: () => pick().streaming(),
        error: () => pick().error(),
        settled: () => pick().settled(),
        done: () => pick().done(),
        isError: (error, name) => pick().isError(error, name),
        watch: (handler) => pick().watch(handler),
        // Cast for the same reason `attachAsync` casts: one implementation serves every instantiation
        // of `then`'s two type parameters, and the erased signature is the honest description of it.
        then: ((onFulfilled: unknown, onRejected: unknown) =>
            (pick() as unknown as { then: (a?: unknown, b?: unknown) => Promise<unknown> }).then(
                onFulfilled,
                onRejected,
            )) as Memo<T>['then'],
    }
    Object.assign(facade, forward)
    return facade
}

function arglessMemo<T>(
    body: () => T,
    options: MemoOptions,
    transform?: (value: unknown) => unknown,
): Memo<T> {
    const fallback = buildArgless(body, options, transform)
    if (options.global === true) return fallback
    return scopedArgless(fallback, () => buildArgless(body, options, transform))
}

// `transform` first, because it is the more specific second argument: an options bag is a WEAK type
// (every member optional), so a function with none of its members is not assignable to it and the
// overload that takes one is skipped rather than matched by accident.
export function memo<T, Out>(
    body: () => Promise<T>,
    transform: (value: T) => Out,
    options?: MemoOptions,
): Memo<Out | undefined>
export function memo<T, Out>(
    body: () => AsyncIterable<T>,
    transform: (value: T) => Out,
    options?: MemoOptions,
): Memo<Out | undefined>
export function memo<T, Out>(body: () => T, transform: (value: T) => Out, options?: MemoOptions): Memo<Out>
export function memo<Args, T, Out>(
    body: (args: Args) => T | Promise<T> | AsyncIterable<T>,
    transform: (value: T) => Out,
    options?: MemoOptions<Args>,
): KeyedMemo<Args, Out>
export function memo<T>(body: () => Promise<T>, options?: MemoOptions): Memo<T | undefined>
// A body that YIELDS is a stream, so what the memo holds is a chunk — the same widening a promise
// gets, for the same reason: there is nothing there until the first one lands.
export function memo<T>(body: () => AsyncIterable<T>, options?: MemoOptions): Memo<T | undefined>
export function memo<T>(body: () => T, options?: MemoOptions): Memo<T>
export function memo<Args, T>(
    body: (args: Args) => T | Promise<T> | AsyncIterable<T>,
    options?: MemoOptions<Args>,
): KeyedMemo<Args, T>
export function memo(
    body: (args?: unknown) => unknown,
    second?: ((value: unknown) => unknown) | MemoOptions,
    third?: MemoOptions,
): unknown {
    const transform = typeof second === 'function' ? second : undefined
    const options = (typeof second === 'function' ? third : second) ?? {}
    // Declaring an argument IS the declaration that args are the dependency set. Args are also the
    // way to get a KEYED cache — one handle per key, each with its own probes and its own tags.
    if (body.length >= 1) return keyedMemo(body as (a: unknown) => unknown, options, transform)
    return arglessMemo(body as () => unknown, options, transform)
}
