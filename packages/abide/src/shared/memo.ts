// `memo` — the memoizer. One name, two forms, split by whether the body DECLARES INPUTS:
//
//   memo(() => a() + b())        no args -> dependencies are inferred from the body (tracked)
//   memo(({ id }) => fetch(id))  args    -> the args ARE the cache key, one slot per key
//
// That is abide's rule verbatim, and it is why there is no second name for "async memo": the load
// path and the derive path are the same concept with different dependency declarations.
//
// A keyed slot IS a state. "A promise is a load" — retain across a re-load, cold `pending` vs warm
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
import { admit, Bounded, release, touch } from './internal/cache.ts'
import {
    type State,
    stateForward,
    derive,
    internals,
    isPending,
    type Memo,
    type MemoHandle,
    Node,
    untrackCall,
} from './internal/graph.ts'
import { keyOf, matcher } from './internal/keys.ts'
import { isAsyncIterable, isThenable } from './internal/probes.ts'
import { currentScope, disposeWith, storeFor } from './internal/scopes.ts'
import { joinTags, type Taggable, taggedTargets } from './internal/tags.ts'
import { arm, NO_LIMIT } from './internal/timers.ts'

// Declared in `#shared/internal/graph.ts` beside `State` and `Memo`, so the family reads in one
// place; re-exported here because THIS is the module a keyed call belongs to — `transport.ts`
// extends it and `abide.ts` takes it from here.
export type { MemoHandle }

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

/**
 * The argument, OPTIONAL when nothing is REQUIRED of it — a body that declares no parameter, or one
 * whose every field has a default (`({ page = 1 }) => …`). `{}` is what the omission means, in
 * process and on the wire alike, so the omitted call and `f({})` select the same slot.
 *
 * Written as a parameter LIST rather than `args?: Args` because the check is on the type and not on
 * the position: `f(id: number)` must keep the argument mandatory, and an optional parameter would
 * make every such call `f()` at the type level while throwing at runtime.
 */
// biome-ignore lint/complexity/noBannedTypes: `{}` is the question — is anything required of `Args` — and `Record<string, never>` answers it wrong, satisfying `{ id: string }` through `never`.
export type Selecting<Args> = {} extends Args ? [args?: Args] : [args: Args]

/**
 * What an omitted `Selecting` call means to `asRpc` — the one face with a bare form to protect. Its
 * sibling `selectedRoom` below is what both socket halves take, and the pair lives beside the type
 * rather than in any one face because a second copy is how a slot key, a wire address and a room key
 * drift apart with nothing red.
 *
 * The ARITY decides, never `?? {}`: `Selecting` is erased, so an omitted argument and an explicit
 * `undefined` are one thing to the type and two at runtime — and `Args` of `void` is a read whose
 * address is the bare one, which coalescing put `?$args=%7B%7D` on.
 */
export function selectedArgs<Args>(given: readonly unknown[]): Args {
    return given.length === 0 ? ({} as Args) : (given[0] as Args)
}

/**
 * The same resolution for a face with NO bare form to protect — both halves of `socket`.
 *
 * An explicit `undefined` collapses here where `selectedArgs` keeps it: an rpc has to tell the two
 * apart because `f()`'s address is the bare one and coalescing would put `?$args=%7B%7D` on it, but a
 * socket's `s()` IS the `{}` room, so there is no third thing for `s(undefined)` to mean. Left on
 * arity it reached `channel()`'s own call, which branches on VALUE and READS — handing back a message
 * where the type says `Channel`.
 */
export function selectedRoom<Args>(given: readonly unknown[]): Args {
    return (given[0] ?? {}) as Args
}

export interface KeyedMemo<Args, T> {
    /** Selects the slot. The handle is where everything else lives; the READ is what kicks a load. */
    (...select: Selecting<Args>): MemoHandle<T>
    /**
     * Every slot MATCHING the pattern — a subset of the args, compared the same way slots are keyed.
     * No pattern means every slot. Exactly one slot is `m(args).invalidate()`, which is why this one
     * is free to mean "match" without the two spellings ever being confused.
     */
    invalidate(pattern?: Partial<Args>): void
    refresh(pattern?: Partial<Args>): void
    /**
     * Is a first load in flight for any slot MATCHING the pattern — no pattern meaning any slot at
     * all? The set question, where `m(args).pending()` is the one about a key you named.
     *
     * ASKING A SET STARTS NOTHING, and it cannot: naming a key is what materialises a cold slot to
     * kick, and a pattern names none. So this is the spelling for a question about work somebody
     * else began — is a delete of this row already going, is anything on this endpoint in flight —
     * where the handle form would send the call it was asked about.
     *
     * Reactive in both directions: it subscribes to every matching slot's own probe AND to the slot
     * set, so a slot that does not exist yet still wakes the asker when it appears.
     */
    pending(pattern?: Partial<Args>): boolean
    refreshing(pattern?: Partial<Args>): boolean
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
            const now = Date.now()
            const since = now - firedAt
            if (since >= throttleMs) {
                firedAt = now
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

/**
 * Every memo DECLARED, so a caller can reach all of its own data without every declaration having
 * remembered to name a tag.
 *
 * A tag names data and is opt-in per declaration, which is right for reaching SPECIFIC data across an
 * app and wrong as the only way to reach breadth: a memo added later silently stopped participating
 * in the button that refreshes everything, and nothing about that is visible.
 *
 * The DECLARATION is what is registered, never a slot — each memo's own no-selector verb is already
 * this caller's, because `cache()` is `storeFor`'d and the argless facade picks per caller. So the
 * per-caller question is answered one level down and this list holds one entry per `memo()` call
 * rather than one per request.
 */
/**
 * WEAKLY, because the lifetime of a declaration is its REACHABILITY and nothing else can stand in
 * for that.
 *
 * The ambient scope at construction cannot: it says who was running, not whose the memo is. A page
 * module is `import()`ed lazily inside the first request that renders its route, so a module-level
 * `memo()` in one is constructed under that request's scope — and disposing with it deleted the
 * declaration permanently, for every later caller. That is the bug this whole list exists to fix,
 * reintroduced one level up: a memo silently stops participating in the sweep and nothing says so.
 *
 * A strong set cannot either: `currentScope()` is null forever in a browser, so nothing would ever
 * be removed and every `memo()` in a component's setup would pin its cache and its captured scope
 * for the life of the page, once per mount.
 *
 * A module holds its declarations, so those stay. A component's and a request's are garbage the
 * moment their owner is, so those go — no disposer, no scope, and nothing to get wrong at a
 * construction site that cannot tell which case it is in.
 */
const declared = new Set<WeakRef<Taggable>>()

/**
 * Drops a husk when its target is COLLECTED, which is the only event that means the husk is garbage.
 *
 * A declaration is per component INSTANCE and per REQUEST — `memo()` compiles inside the setup a
 * render runs — so a server makes one per request for the life of the process. Left to the verbs
 * below, which are user-invoked and which most apps never call at all, nothing dropped them: 238
 * bytes retained per render over 20k renders of a two-memo page, growing without bound.
 *
 * An amortised sweep from `declareReachable` was tried first and MEASURED NO DIFFERENCE — 238.9
 * against 238.0 bytes per render. The mechanism is why, and it is not a tuning problem: a sweep
 * triggered by declaring runs BEFORE the collection it is looking for, so every husk still derefs
 * live, nothing is pruned, and the size it doubles from ratchets up until sweeps all but stop. The
 * trigger has to be the collection itself.
 */
const collected = new FinalizationRegistry<WeakRef<Taggable>>((husk) => declared.delete(husk))

function declareReachable(target: Taggable): void {
    const husk = new WeakRef(target)
    declared.add(husk)
    collected.register(target, husk)
}

/**
 * The declarations still reachable, pruning the collected ones on the way past.
 *
 * Still prunes, because a registry callback is not prompt: a husk whose target is gone but whose
 * callback has not run yet is one this walk would otherwise hand back as live.
 */
function liveDeclarations(): Taggable[] {
    const live: Taggable[] = []
    for (const ref of declared) {
        const target = ref.deref()
        if (target === undefined) declared.delete(ref)
        else live.push(target)
    }
    return live
}

/**
 * What a verb REACHES: the tagged targets, or — with no selector — every declaration.
 *
 * One resolver over both verbs, because they differ in the method they call and in nothing else, and
 * the branch drifting in one of them alone is invisible. The COLLECTION only, which is the split
 * `taggedTargets` already keeps for the same reason: taking the verb as a parameter costs a name, a
 * branch and two loops to re-derive what each call site spells in one word.
 */
function reachable(selector?: TagSelector, scope?: unknown): Iterable<Taggable> {
    return selector === undefined ? liveDeclarations() : taggedTargets(selector.tags, scope)
}

/**
 * Everything carrying any of these tags — or, with no selector, everything the CURRENT CALLER holds.
 *
 * `scope` narrows the tag form to one memo's slots.
 */
export function invalidate(selector?: TagSelector, scope?: unknown): void {
    for (const target of reachable(selector, scope)) target.invalidate()
}
/**
 * Re-run everything carrying any of these tags now — or, with no selector, everything the CURRENT
 * CALLER holds. `scope` narrows the tag form to one memo's slots.
 *
 * `invalidate` above is the other half and the commoner one: it says the value is WRONG and lets the
 * next read pay for it. This says run the body, whether or not anybody is reading.
 */
export function refresh(selector?: TagSelector, scope?: unknown): void {
    for (const target of reachable(selector, scope)) target.refresh()
}

function keyedMemo<Args, T>(
    body: (args: Args) => T | Promise<T>,
    options: MemoOptions<Args>,
    transform?: (value: unknown) => unknown,
): KeyedMemo<Args, T> {
    const ttl = options.ttl ?? NO_LIMIT
    const throttleMs = options.throttle ?? 0
    const debounceMs = options.debounce ?? 0
    const paced = throttleMs > 0 || debounceMs > 0
    const tags = options.tags
    /**
     * One caller's slots, and the node saying that SET moved.
     *
     * Together because they describe each other: a set probe reads every matching slot's own tracker,
     * which wakes it when one of those transitions and says nothing about a slot that does not exist
     * yet — the case the probe is usually FOR, since a gate asking whether a delete of this row is in
     * flight is asked before the click that creates the slot.
     *
     * `membership` is per caller for the same reason `slots` is. Process-global it woke every OTHER
     * caller's set probe on a slot creation in a cache that reader cannot see, which re-walks an
     * unchanged map and answers what it already answered — a wake on nothing, and the one failure
     * class a correctness test cannot see.
     *
     * Bumped on CREATE only. A slot leaving cannot flip an answer this node is needed for: a
     * `pending` slot stands down through its own tracker, which the probe has already read, and the
     * eviction that follows is of something settled.
     */
    interface Cache {
        slots: Map<string, { slot: Slot<T>; args: Args }>
        membership: Node
    }
    const makeCache = (): Cache => ({ slots: new Map(), membership: new Node(0, null) })
    const shared = makeCache()
    const isGlobal = options.global === true

    // Which cache this caller reads. `shared` is the one every caller uses when there is no caller
    // scope — a client, a script, a test — so the client pays one null check and no lookup.
    function cache(): Cache {
        if (isGlobal) return shared
        return storeFor(call, makeCache, shared)
    }

    function slotFor(args: Args): Slot<T> {
        const held = cache()
        const slots = held.slots
        const key = keyOf(args)
        const entry = slots.get(key)
        if (entry !== undefined) {
            // The SELECT is the recency signal, because it is the one thing every access to a slot
            // goes through — a read, a peek and a probe alike all start at `m(args)`.
            const bound = entry.slot.bounded
            if (bound !== null) touch(bound)
            return entry.slot
        }

        // COLD, not `state(undefined)`: the slot holds nothing, it has not loaded nothing. ASKING is
        // what kicks it — a read, an await or a probe — while selecting the slot and peeking at it
        // start nothing.
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
                // NULL for a global slot, never `currentScope()`. This runs inside whichever request
                // first created the slot, and a `{ global }` slot is not that request's — capturing
                // the ambient scope would bind a process-wide copy to one caller and leave every
                // other one unable to reach it. Green in a browser either way, where there is no
                // scope to capture.
                caller: isGlobal ? null : currentScope(),
            })
            // A per-caller slot must leave the registry with its caller, or the module-level map
            // grows by one entry per request forever.
            if (!isGlobal) disposeWith(leave)
        }

        // Only the PROCESS cache is bounded — `{ global }`'s map, and the one every caller shares
        // where there is no caller scope. Those are the two that outlive whoever filled them.
        if (held === shared) {
            slot.bounded = new Bounded(slots as Map<string, unknown>, key, leave)
        }

        slots.set(key, { args, slot })
        // AFTER the insert, so a set probe woken by this finds the slot it is being told about.
        held.membership.write((held.membership.value as number) + 1)
        return slot
    }

    const stale = (slot: Slot<T>): boolean =>
        slot.loadedAt === 0 || (ttl !== NO_LIMIT && Date.now() - slot.loadedAt >= ttl)

    // Run the body into the slot. Returns nothing: a caller that wants the outcome asks the handle,
    // never the body's own promise. That is what makes coalescing, newest-wins and "invalidate
    // mid-load tells the awaiters" true for `await m(args)` too.
    function start(args: Args, slot: Slot<T>): void {
        let produced: T | Promise<T>
        try {
            produced = untrackCall(body, args)
        } catch (error) {
            // …but a read with nothing to serve YET is not a throw the slot settles: the body has not
            // run, so it is not loaded and it has not failed. Recorded as a failure the slot never
            // recovers — the retry finds it loaded, serves the retained error, and the walk waits on
            // a load that already ended. The signal goes back to whoever will call this again.
            if (isPending(error)) throw error
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
        // Stamped BEFORE the state settles, so a reader woken by the settle cannot see the slot stale
        // and kick a second load. Handing the state the raw promise would leave that a race.
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
        // The state does the rest: cold → `pending`, warm → `refreshing` over the retained value,
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
        for (const entry of cache().slots.values()) {
            if (wanted(entry.args)) entry.slot.handle.invalidate()
        }
    }
    call.refresh = (pattern?: Partial<Args>): void => {
        const wanted = matcher(pattern)
        for (const entry of cache().slots.values()) {
            if (wanted(entry.args)) entry.slot.handle.refresh()
        }
    }

    /**
     * The same walk, asking instead of acting.
     *
     * `quietly` wraps the WHOLE walk rather than each ask: it only clears the kick, so every slot's
     * tracker is still READ and the asker still subscribes to all of them — and one closure per
     * call beats one per slot in a loop that is already per row for a memo keyed per row.
     *
     * Deliberately no short-circuit. Returning at the first `true` would leave the asker subscribed
     * to that slot alone; correct today, because the one it read is the one that has to stand down
     * before the answer can change, and one bad refactor away from silently waking on nothing.
     */
    const asked =
        (probe: (handle: MemoHandle<T>) => boolean) =>
        (pattern?: Partial<Args>): boolean =>
            internals.quietly(() => {
                const held = cache()
                held.membership.read()
                const wanted = matcher(pattern)
                let any = false
                for (const entry of held.slots.values()) {
                    if (wanted(entry.args) && probe(entry.slot.handle)) any = true
                }
                return any
            })
    call.pending = asked((handle) => handle.pending())
    call.refreshing = asked((handle) => handle.refreshing())

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
    const ttl = options.ttl ?? NO_LIMIT
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

    const held: Memo<T> =
        ttl === NO_LIMIT
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
                      if (loadedAt === 0 || internals.loading(held)) return
                      if (Date.now() - loadedAt >= ttl) held.refresh()
                  },
                  transform,
              )

    // The pacing is the keyed form's, one state instead of one slot: it wraps the EXPLICIT verb, so a
    // ttl expiring on a read still recomputes in the call and only `refresh` waits for a window.
    // The same predicate the keyed form spells as `paced`: a window of zero is not a window, so
    // `{ throttle: 0 }` builds no pacer here either.
    const throttleMs = options.throttle ?? 0
    const debounceMs = options.debounce ?? 0
    if (throttleMs > 0 || debounceMs > 0) {
        const window = pacer(throttleMs, debounceMs)
        const run = held.refresh
        held.refresh = () => window.fire(loadedAt !== 0, run)
        const drop = held.invalidate
        held.invalidate = () => {
            window.cancel()
            drop()
        }
        if (options.global !== true) disposeWith(() => window.cancel())
    }

    if (options.tags !== undefined) {
        const names = typeof options.tags === 'function' ? options.tags(undefined) : options.tags
        // `buildArgless` is called once for the module-level fallback and again per caller by
        // `scopedArgless`, so the ambient scope at THIS call is whose state this is — and is null for
        // the fallback and for a `{ global }` memo alike, which is the same answer both want.
        const leave = joinTags(names, {
            owner: held,
            target: held,
            caller: options.global === true ? null : currentScope(),
        })
        if (options.global !== true) disposeWith(leave)
    }
    return held
}

// The argless form has no args key to hang a per-caller cache off, so the STATE itself is what varies
// — which means the thing handed back has to be a facade over "whichever state belongs to the caller
// asking". The keyed form needs none of this: its cache is already a map, so scoping it is choosing a
// different map.
//
// The cost is one extra frame per member call, and it is paid only where a scope can exist. On a
// client `currentScope()` is a null check that always answers the same way, so the facade forwards
// straight to the module-level state — see the `global` arm of the scope bench, which measures exactly
// this by comparing a facade read against the raw state it wraps.
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

    // The state surface comes from `stateForward`, which is where the `keyof State` check lives; what a
    // MEMO adds on top of it is these two, typed by `Omit` so that surface stays exhaustively checked
    // as well. A member added to either interface is a type error in exactly one place.
    //
    // Deliberately no `abide.state`: that symbol names ONE node, and the whole point of the facade is
    // that the node varies by caller. `internals` is handed the inner state, never this.
    const verbs: Omit<Memo<T>, keyof State<T>> = {
        refresh: () => pick().refresh(),
        dispose: () => pick().dispose(),
    }
    Object.assign(facade, stateForward(pick as unknown as () => State<unknown>), verbs)
    return facade
}

function arglessMemo<T>(
    body: () => T,
    options: MemoOptions,
    transform?: (value: unknown) => unknown,
): Memo<T> {
    const fallback = buildArgless(body, options, transform)
    // The FACADE is what joins, not the fallback state: its two verbs pick the asking caller's own
    // instance, which is the same per-caller answer the keyed form gets from its scoped cache.
    const made =
        options.global === true
            ? fallback
            : scopedArgless(fallback, () => buildArgless(body, options, transform))
    return made
}

// `transform` first, because it is the more specific second argument: an options bag is a WEAK type
// (every member optional), so a function with none of its members is not assignable to it and the
// overload that takes one is skipped rather than matched by accident.
//
// `Awaited<Out>` on all four, because a transform that hands back a promise is a LOAD like any other
// — the read serves what it resolves to. Sync transforms, which is every one of them today, are
// unaffected: `Awaited<string>` is `string`.
/**
 * A derived value that recomputes whenever anything it read changes.
 *
 * A promise or async-iterable body is the same `Memo<T>`: a load that has not landed is not part of
 * the read's type, because the read SIGNALS instead of reporting `undefined`.
 */
export function memo<T, Out>(
    body: () => Promise<T>,
    transform: (value: T) => Out,
    options?: MemoOptions,
): Memo<Awaited<Out>>
export function memo<T, Out>(
    body: () => AsyncIterable<T>,
    transform: (value: T) => Out,
    options?: MemoOptions,
): Memo<Awaited<Out>>
export function memo<T, Out>(
    body: () => T,
    transform: (value: T) => Out,
    options?: MemoOptions,
): Memo<Awaited<Out>>
export function memo<Args, T, Out>(
    body: (args: Args) => T | Promise<T> | AsyncIterable<T>,
    transform: (value: T) => Out,
    options?: MemoOptions<Args>,
): KeyedMemo<Args, Awaited<Out>>
export function memo<T>(body: () => Promise<T>, options?: MemoOptions): Memo<T>
// A body that YIELDS is a stream, and what the memo holds is a chunk. No widening for either shape:
// a read that has nothing yet signals rather than reporting `undefined`, so the absence shows up on
// `peek` and nowhere else.
export function memo<T>(body: () => AsyncIterable<T>, options?: MemoOptions): Memo<T>
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
    // Declared HERE rather than in the two builders: this is the only path into either, and the
    // failure the list exists to catch — a memo that silently stops participating in the sweep — is
    // exactly what a third builder with the call left in the leaves would reintroduce.
    const made =
        body.length >= 1
            ? keyedMemo(body as (a: unknown) => unknown, options, transform)
            : arglessMemo(body as () => unknown, options, transform)
    declareReachable(made as Taggable)
    return made
}
