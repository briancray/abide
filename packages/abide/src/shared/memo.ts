// The abide MEMO primitive — a generic isomorphic memoizer (rpc-core §1-3, §7.2, §8; ADR 0024).
//
// `memo(fn)` wraps any function into a smart-read callable: per-context caching,
// in-flight coalescing, and a reactive read surface (peek/pending/error/refreshing/watch/
// refresh/invalidate/publish). RPC/socket helpers bake this behavior in; users reach for
// `memo()` to wrap their OWN third-party async functions and get identical ergonomics.
//
// A memo's DEPENDENCIES ARE ITS DECLARED INPUTS (ADR 0024 §1). Declare an arg and they are the cache key
// — today's memo/RPC, untouched. Declare NONE and they are inferred from the body: an argless memo whose
// first run produces a plain value synchronously becomes AUTO-TRACKED (computed-backed, §2-3) and is the
// whole of the retired `state.computed`; `.state(args)` makes it writable and is the whole of the retired
// `state.linked` (§4). Two factories became zero.
//
// Each cache slot `(memoId, canonicalKey(args))` IS a state (§7.2): reading it in a
// tracking context subscribes; resolve/invalidate/publish re-run subscribers. The slot is a
// state machine idle -> pending -> value | error, with a `refreshing` flag while
// revalidating over a retained value. pending/error/refreshing/peek are derived views of
// the one slot, not separate channels.
//
// The opt-in server SHARED cross-request cache (`memo: { shared: true }`, rpc-core §2) is wired
// here: a shared memo stores its slots in the process-global `sharedStore()` and runs its handler
// fail-closed (scope-exited + ambient-guarded), server-only. A shared memo's verbs also fire an
// injectable, TRANSPORT-FREE `notify` sink (rpc-core §8 broadcast, PR2): the memo just calls it —
// `createApp` binds it to the actual channel publish (the memo never imports transport). A shared
// memo declaring `tags` (PR4) registers itself in the server tag registry so the global
// `invalidate/refresh({ tags })` selectors can drop/revalidate + broadcast its slots. TODO (later
// PRs): the client-side channel join/apply.

import { registerTaggedMemo } from '../server/internal/memoTags.ts'
import { currentScope, runOutsideScope } from '../server/internal/scope.ts'
import { canonicalKey } from './internal/codec.ts'
import { getContext, onContextDispose, serverDefaultContext } from './internal/context.ts'
import { isBrowser } from './internal/isBrowser.ts'
import { positiveEnvBytes } from './internal/positiveEnvBytes.ts'
import { type Computed, computed, effect, type State, state, untrack } from './internal/reactive.ts'
import type { ReactiveReadSurface } from './internal/reactiveReadSurface.ts'
import { ReplayableStream } from './internal/replayableStream.ts'
import { responseSourceOf, tagStreamEncoding } from './internal/responseSource.ts'
import { markSettled } from './internal/settledRead.ts'
import {
    sharedCacheEvictIfNeeded,
    sharedCachePin,
    sharedCacheRecordSize,
    sharedCacheTouch,
    sharedCacheUnpin,
    sharedStore,
} from './internal/sharedCache.ts'
import { log } from './log.ts'

// `shared` is a SERVER concept (cross-request store + scope isolation). On the client a shared-flagged
// memo behaves like a normal client memo, so every shared-only branch below is gated on `!isBrowser`.

// "stream" is the streaming-read slot (replayable-streams.md §4): the resolved value is not a scalar
// but a ReplayableStream the read fans out via `consume()`. Scalar (`value`) and stream slots stay
// monomorphic in their own field — a stream slot's `value` is always undefined and vice versa.
type Status = 'idle' | 'pending' | 'value' | 'error' | 'stream'

// One immutable snapshot of a slot's state. Held inside the slot state; every transition
// replaces it with a fresh object so the state's `===` comparison always fires.
interface SlotState<T> {
    status: Status
    value: T | undefined
    error: unknown
    refreshing: boolean
    // Set only when status === "stream": the shared replay buffer this slot fans out (§4).
    stream?: ReplayableStream<unknown>
}

interface Slot<Args, T> {
    args: Args
    // The full cache-map key (`prefix + canonicalKey(args)`), retained for LRU touch/size accounting.
    key: string
    state: State<SlotState<T>>
    // The single in-flight load promise for this slot; the coalescing point.
    inflight: Promise<T> | null
    // When the current value/error settled (ms epoch), for TTL expiry. 0 while idle.
    loadedAt: number
    // Bumped on invalidate/refresh so a superseded in-flight load discards its late result.
    generation: number
    // Reactive chunk-progress tick for a STREAM slot (set on first stream start). Bumped on every chunk
    // push and on the terminal, so `latest`/`chunks`/`done` re-run as the transcript grows — kept SEPARATE
    // from `state` so per-chunk updates never re-run the bare read (which would restart a `{#for await}`).
    streamTick?: State<number>
    // AUTO-TRACKED backing (ADR 0024 §1-3), installed only once the first run of an argless `fn` has
    // proved it produces a plain value synchronously. While it is set, this slot's whole state machine
    // lives in the computed graph below and `state`/`inflight`/`loadedAt` go unused.
    auto?: AutoBacking<T>
    // True once the fill mode has been decided for this slot, so `fn` is classified exactly once.
    modeResolved?: boolean
}

// One run of an AUTO-TRACKED fill. `run` counts fills of this slot. `deferred` carries the produced value
// when the run turned out to be async/streaming after all — only the produced value can tell (ADR 0024
// §2), so the classifier hands it straight to the classic coalesced path rather than re-invoking `fn`.
type AutoFill<T> = { run: number; state: SlotState<T> } | { run: number; deferred: unknown }

// The AUTO-TRACKED backing of one slot (ADR 0024 §1-3). `fn`'s synchronous reads ARE this memo's declared
// inputs, so it runs inside a `computed` whose dependency set is re-collected on every run. Pull-based, so
// a read that follows a dependency write in the same tick already sees the fresh value — no microtask lag.
//
// A `publish` stamps the `run` it overrode, and `merged` honours an override only while that stamp is
// still current. A dependency change re-runs `fn`, advancing `run`, which drops the override. That single
// rule is the whole of the retired `state.linked`: provisional until re-fill (ADR 0024 §Context).
interface AutoBacking<T> {
    // Bumped by invalidate/refresh to force a re-run even when no dependency changed.
    version: State<number>
    fill: Computed<AutoFill<T>>
    override: State<{ run: number; state: SlotState<T> } | null>
    merged: Computed<SlotState<T>>
    // Whether a fill has run, so `snapshot()` reports a filled slot without forcing a cold one to run.
    filled: () => boolean
}

// SERVER-ONLY broadcast sink (rpc-core §8, PR2). A shared memo calls this when a verb changes a
// slot: `invalidate`/`refresh` pass `(verb, args)`; value-form `publish` passes `(verb, args, value)`.
// The sink is transport-free from the memo's view — `createApp` binds it to a channel publish. `args`
// is the selector as given to the verb (partial or full), typed loosely since it may be a subset.
export type MemoNotify = (
    verb: 'invalidate' | 'refresh' | 'publish',
    args: unknown,
    value?: unknown,
) => void

export interface MemoOptions {
    // Retained-value TTL in ms. Default Infinity (SWR-style: retained until invalidate/refresh).
    ttl?: number
    // Explicit, stable memo id. Auto-generated per instance when omitted.
    key?: string
    // Opt-in server cross-request cache (rpc-core §2). Server-only; INERT on the client (a
    // shared-flagged client memo behaves like a normal client memo). Slots live in the process-global
    // `sharedStore()` keyed only by args — safe ONLY for functions pure over their args. Enforced
    // fail-closed: the handler runs outside the request scope and a read requires an active scope.
    shared?: boolean
    // SERVER-ONLY broadcast sink (rpc-core §8, PR2). Only invoked on a `shared` memo — a non-shared
    // memo never broadcasts even if a sink is present. Injected transport-free; `createApp` binds it.
    notify?: MemoNotify
    // Cache tags (rpc-core §8, PR4). Server-only and honored ONLY on a `shared` memo: the memo
    // registers under each tag so the global `invalidate/refresh({ tags })` selectors can drop/
    // revalidate + broadcast its slots. Inert on the client and on a non-shared memo.
    tags?: string[]
}

// Options an AUTO-TRACKED memo may carry (ADR 0024 §1-3). `ttl` and `shared` are retention policies for a
// PULLED value; a synchronous derivation has nothing to retain and no cross-request identity, so naming
// either one is what opts a memo back onto the classic promise path — the type and the runtime classifier
// agree on that (see the overloads on `memo`).
export type SyncMemoOptions = Omit<MemoOptions, 'ttl' | 'shared'>

// A `memo` is the SCOPED / LOSSLESS / PULL implementation of the shared `ReactiveReadSurface` (the
// probe/verb vocabulary — peek/pending/refreshing/error/chunks/done/refresh/invalidate/publish/watch,
// inherited below), plus the memo-specific extras: the awaitable bare read, hydration seed/snapshot, and
// stream resume. A `socket`/`channel` implements the SAME surface over its hub (ADR 0023 step 6).
export interface Memo<Args, T> extends ReactiveReadSurface<Args, T> {
    // THE READ (Promise-read model): the bare call is the awaitable, coalesced load. It ALSO subscribes
    // the calling reactive context to the slot, so a reactive `{await memo()}` re-runs and re-awaits when
    // the slot invalidates. Resolves with the value or rejects with the error.
    (args: Args): Promise<T>
    // Widens the shared `publish` with the scalar UPDATER form (read-modify-write): a `Memo` value slot
    // may be mutated from its current value. A channel/socket only appends, so this overload is
    // memo-specific. The value form is inherited from ReactiveReadSurface.
    publish(args: Args, next: T | ((current: T | undefined) => T)): void
    // The WRITABLE PROJECTION of one slot (ADR 0024 §4) — and only that; reading a memo is the bare call,
    // `{…}`, `.peek()` and `await`, which already have defined blocking behaviour. The returned cell reads
    // the slot reactively (`.peek()` semantics) and its `set` IS `publish`, so a local write is provisional
    // until the next re-fill. That is the whole of the retired `state.linked`.
    state(args: Args): State<T>
    // @deprecated Use the bare call — `memo(args)` IS the load now. Retained as a non-subscribing alias
    // during migration (identical to the bare call minus the reactive subscription).
    load(args: Args): Promise<T>
    // Resume a RETAINED stream transcript from chunk index `from` (replay `chunks[from..]` then live) —
    // the server side of the SSR→client attach (replayable-streams.md §5). `fresh: true` (with no cursor)
    // means no retained transcript exists, so the caller must run fresh from 0 and REPLACE, not append.
    resumeStream(
        args: Args,
        from: number,
    ): { cursor: AsyncIterable<unknown> | undefined; fresh: boolean }
    // Every resolved slot in the active context — the SSR record source for the hydration seed
    // (rpc-core §5). Only `value`-state slots are reported; pending/error/idle are skipped.
    snapshot(): Array<{ args: Args; value: T }>
    // Replay a recorded (args, value) into the cache as a settled `value` slot, so a matching read
    // resolves from cache instead of re-loading — the client half of §5 hydration seeding.
    seed(args: Args, value: T): void
    // The STREAMING analog of `seed` (§5): install a warm stream slot from an SSR handoff so a hydrate read
    // replays it with NO client re-invoke, and `peek`/`chunks`/`done`/`refresh` reflect it. A finite array
    // is a completed (mode-A) transcript; an AsyncIterable is the mode-B "prefix then resumed tail" source
    // (it closes the slot when the resume ends).
    seedStream(
        args: Args,
        source: readonly unknown[] | AsyncIterable<unknown>,
        encoding?: 'jsonl' | 'sse',
    ): void
}

// An AUTO-TRACKED memo: `fn` declares no inputs and produces a plain value synchronously, so its
// dependencies are inferred from the body (ADR 0024 §1-2) and THE BARE CALL RETURNS `T`, NOT `Promise<T>`
// (§3 — a promise-returning read would blank the server-rendered text and refill it a microtask later,
// because `interpolate` clears the node before awaiting a thenable). This is the retired `state.computed`;
// `.state()` makes it writable and is the retired `state.linked`.
//
// The slot is keyed by no args, so every probe/verb inherited from `Memo<void, T>` is callable bare
// (`peek()`, `refresh()`, `invalidate()`, `state()`) — a `void` parameter may be omitted.
export interface SyncMemo<T> extends Omit<Memo<void, T>, 'load'> {
    (): T
}

let memoCounter = 0

function idleState<T>(): SlotState<T> {
    return { status: 'idle', value: undefined, error: undefined, refreshing: false }
}

// Per-stream transcript cap in bytes (replayable-streams.md §4). Read fresh each call. Default =
// Infinity (UNBOUNDED) — mirroring ABIDE_MAX_SHARED_CACHE_SIZE's consciously-accepted memory tradeoff;
// the env var is the operator mitigation. When set, a stream exceeding it OVERFLOWs (bounded memory,
// no post-close replay) rather than growing unbounded.
function streamBufferCap(): number {
    return positiveEnvBytes('ABIDE_MAX_STREAM_BUFFER_SIZE')
}

// Byte measure for LRU accounting: the settled value's JSON length. Unrepresentable values
// (circular / functions) fall back to 0 rather than throwing on a happy-path settle.
function measureBytes(value: unknown): number {
    try {
        const json = JSON.stringify(value)
        return typeof json === 'string' ? json.length : 0
    } catch {
        return 0
    }
}

// A streaming handler yields a raw AsyncIterable<chunk> (replayable-streams.md §4) — that is what the
// memo wraps in a ReplayableStream. A `Response` / `ReadableStream` is an opaque byte body (jsonl/sse or
// a raw fetch), NOT a decoded-chunk source, so it stays a scalar value and the existing pass-through
// behavior is untouched.
function isStreamSource(value: unknown): value is AsyncIterable<unknown> {
    if (value === null || typeof value !== 'object') return false
    if (value instanceof Response || value instanceof ReadableStream) return false
    return (
        typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
    )
}

// Any thenable, not just a native Promise — the auto-tracked classifier must treat a hand-rolled or
// third-party promise exactly as it treats `await`, which follows `.then`.
function isThenable(value: unknown): value is Promise<unknown> {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
    return typeof (value as { then?: unknown }).then === 'function'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

// A selector's canonical keys, computed ONCE per verb call. `selectSlots` scans every slot of the memo,
// so deriving the selector side inside the per-slot match recomputed identical `canonicalKey(selector…)`
// values (each with its own alloc) for every slot — O(slots × selectorKeys) → O(slots + selectorKeys).
type CompiledSelector =
    | { kind: 'object'; keys: string[]; values: string[] }
    | { kind: 'exact'; canonical: string }

function compileSelector(selector: unknown): CompiledSelector {
    if (isPlainObject(selector)) {
        const keys = Object.keys(selector)
        const values: string[] = []
        for (let i = 0; i < keys.length; i++) values.push(canonicalKey(selector[keys[i] as string]))
        return { kind: 'object', keys, values }
    }
    return { kind: 'exact', canonical: canonicalKey(selector) }
}

// Superset match (§8.2): a selector object matches a slot whose args include every selector
// key with a canonically-equal value. Non-object selectors fall back to exact key equality.
function matchesSelector(slotArgs: unknown, compiled: CompiledSelector): boolean {
    if (compiled.kind === 'object') {
        if (!isPlainObject(slotArgs)) return false
        const keys = compiled.keys
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i] as string
            if (!(key in slotArgs)) return false
            if (canonicalKey(slotArgs[key]) !== compiled.values[i]) return false
        }
        return true
    }
    return canonicalKey(slotArgs) === compiled.canonical
}

// `fn.length` reports 0 for `(args = {}) => …` and `(...args) => …` too, which would silently reclassify
// an args-keyed memo as auto-tracked (ADR 0024 §Consequences). Only a genuinely EMPTY parameter list may
// take the auto path, so read the list out of the source text and refuse the false zeros loudly. The form
// type derivation relies on — `({ n = 0 }) => …` — reports 1 and never reaches here.
function declaresParameters(fn: (...args: never[]) => unknown): boolean {
    const source = fn.toString()
    const open = source.indexOf('(')
    if (open === -1) return false // `x => …` reports length 1, so this can only be an exotic callable
    let depth = 0
    for (let i = open; i < source.length; i++) {
        const char = source[i]
        if (char === '(' || char === '[' || char === '{') depth++
        else if (char === ')' || char === ']' || char === '}') {
            depth--
            if (depth === 0) return source.slice(open + 1, i).trim() !== ''
        }
    }
    return false
}

// THE READ, argless + synchronous (ADR 0024 §2-3): auto-tracked, returns `T`.
export function memo<T>(fn: () => Promise<T>, opts?: MemoOptions): Memo<void, T>
export function memo<C>(
    fn: () => AsyncIterable<C>,
    opts?: MemoOptions,
): Memo<void, AsyncIterable<C>>
export function memo<T>(fn: () => T, opts?: SyncMemoOptions): SyncMemo<T>
// The TWO-ARGUMENT form (ADR 0024 §1): the source thunk is the declared input, so only it is tracked and
// the transform runs untracked — the same rule and the same mechanism as `watch(source, handler)`.
export function memo<S, T>(
    source: () => S,
    transform: (value: S) => T,
    opts?: SyncMemoOptions,
): SyncMemo<T>
export function memo<Args, T>(fn: (args: Args) => Promise<T> | T, opts?: MemoOptions): Memo<Args, T>
// One runtime object serves every overload — the auto-tracked path is a second FILL PATH for the same
// slot, not a second surface (ADR 0024 §3), so the implementation signature just spans both faces.
export function memo<Args, T>(
    body: (args: Args) => Promise<T> | T,
    transformOrOpts?: ((value: never) => unknown) | MemoOptions,
    trailingOpts?: MemoOptions,
): Memo<Args, T> | SyncMemo<T> {
    const transform =
        typeof transformOrOpts === 'function'
            ? (transformOrOpts as unknown as (value: unknown) => T)
            : undefined
    const opts: MemoOptions | undefined =
        transform === undefined ? (transformOrOpts as MemoOptions | undefined) : trailingOpts
    // Collapse the two-argument form into ONE argless body so everything below sees a single `fn`: the
    // source read stays tracked (it IS the declared input), the transform is wrapped in `untrack`.
    const fn: (args: Args) => Promise<T> | T =
        transform === undefined
            ? body
            : () => {
                  const value = (body as unknown as () => unknown)()
                  return untrack(() => transform(value))
              }
    const ttl = opts?.ttl ?? Infinity
    const id = opts?.key ?? `memo#${++memoCounter}`
    // `shared` is server-only; on the client it is inert (falls through to the client context cache).
    const shared = opts?.shared === true && !isBrowser
    const notify = opts?.notify
    // Tags are honored only on a shared (server) memo — the tag registry is a server concept.
    const tags = shared ? (opts?.tags ?? []) : []

    // Could this memo take the AUTO-TRACKED path (ADR 0024 §1-2)? Only an argless `fn` declares no inputs,
    // and only a memo with no retention policy has nothing to retain: an explicit `ttl` (including the
    // `ttl: 0` a `memo: false` read compiles to) or `shared: true` keeps the classic pulled-value machinery,
    // which is also what the `SyncMemoOptions` overload encodes so types and runtime cannot disagree.
    // Whether it ACTUALLY takes it is decided by the first run — see `resolveMode`.
    const autoEligible = fn.length === 0 && ttl === Infinity && !shared
    if (fn.length === 0 && declaresParameters(fn)) {
        throw new TypeError(
            'memo: a rest or defaulted parameter (`(...args) => …` / `(args = {}) => …`) reports ' +
                'fn.length 0, which would silently reclassify this args-keyed memo as auto-tracked. ' +
                'Name the parameter without a default, or destructure with per-field defaults ' +
                '(`({ n = 0 }) => …`).',
        )
    }

    // Fire the broadcast sink for a slot-changing verb — ONLY on a shared memo (broadcast is a
    // shared-slot concept). Transport-free: the memo just calls the injected function.
    function broadcast(
        verb: 'invalidate' | 'refresh' | 'publish',
        args: unknown,
        value?: unknown,
    ): void {
        if (shared && notify !== undefined) notify(verb, args, value)
    }
    // Namespace slots within the backing cache map. \x00 keeps the prefix distinct from any
    // canonicalKey output.
    const prefix = `\x00memo\x00${id}\x00`

    // The cache Map backing this memo's slots: the process-global shared store for a `shared` memo,
    // otherwise the ambient per-context cache (per-request on the server, singleton on the client).
    function slots(): Map<string, unknown> {
        return shared ? sharedStore() : getContext().slots
    }

    // The LRU-bounded store backing `cache`, if any. Only the shared store and the persistent server
    // default context are bounded by ABIDE_MAX_SHARED_CACHE_SIZE; per-request caches die with the
    // request and the client cache dies with the tab, so neither is bounded.
    function boundedStore(cache: Map<string, unknown>): Map<string, unknown> | undefined {
        if (isBrowser) return undefined
        if (cache === sharedStore() || cache === serverDefaultContext()?.slots) return cache
        return undefined
    }

    // Fail-closed checkpoint (b), rpc-core §2: a shared read must run inside an active request scope
    // (an authorized caller). A bare script/cron read has no gate and no client to serve, so it
    // throws rather than silently touching the cross-request store. Server-only; inert on the client.
    function guardSharedRead(): void {
        if (shared && currentScope() === undefined) {
            throw new Error('shared memo read requires an active request scope')
        }
    }

    // Move a bounded slot to MRU on read so LRU eviction drops least-recently-read first.
    function touchOnRead(slot: Slot<Args, T>): void {
        if (!shared && isBrowser) return
        const store = boundedStore(slots())
        if (store !== undefined) sharedCacheTouch(store, slot.key)
    }

    function ensureSlot(args: Args): Slot<Args, T> {
        const cache = slots()
        const slotKey = prefix + canonicalKey(args)
        let slot = cache.get(slotKey) as Slot<Args, T> | undefined
        if (slot === undefined) {
            slot = {
                args,
                key: slotKey,
                state: state(idleState<T>()),
                inflight: null,
                loadedAt: 0,
                generation: 0,
            }
            cache.set(slotKey, slot)
        }
        return slot
    }

    // Every slot belonging to this memo in the active context (optionally filtered by selector).
    function selectSlots(selector: Partial<Args> | Args | undefined): Slot<Args, T>[] {
        const cache = slots()
        const result: Slot<Args, T>[] = []
        // Compile the selector's canonical keys once, not per slot scanned.
        const compiled = selector === undefined ? undefined : compileSelector(selector)
        for (const [slotKey, entry] of cache) {
            if (typeof slotKey !== 'string' || !slotKey.startsWith(prefix)) continue
            const slot = entry as Slot<Args, T>
            if (compiled === undefined || matchesSelector(slot.args, compiled)) result.push(slot)
        }
        return result
    }

    function isExpired(slot: Slot<Args, T>): boolean {
        if (ttl === Infinity) return false
        const state = slot.state.peek()
        if (state.status === 'stream') {
            // An OPEN stream is retained regardless of ttl (§2); a CLOSED one expires on the ttl-from-close
            // clock (`loadedAt` is stamped when the ReplayableStream settles, not when `fn` resolved).
            const stream = state.stream
            if (stream === undefined || !stream.settled) return false
            return Date.now() - slot.loadedAt >= ttl
        }
        if (state.status !== 'value' && state.status !== 'error') return false
        return Date.now() - slot.loadedAt >= ttl
    }

    function setState(slot: Slot<Args, T>, next: SlotState<T>): void {
        slot.state.set(next)
    }

    // Begin (or coalesce onto) a load for this slot. `keepStale` retains the current value and
    // flips `refreshing` on instead of dropping to a bare pending state. `preProduced`, when set, is a
    // value `fn` ALREADY produced (the auto-tracked classifier's single probe run turned out to be
    // async/streaming), so the load settles it instead of invoking `fn` a second time.
    function startLoad(
        slot: Slot<Args, T>,
        keepStale: boolean,
        preProduced?: { produced: unknown },
    ): Promise<T> {
        if (slot.inflight !== null) return slot.inflight

        const current = slot.state.peek()
        if (keepStale && current.status === 'value') {
            setState(slot, {
                status: 'value',
                value: current.value,
                error: undefined,
                refreshing: true,
            })
        } else {
            setState(slot, {
                status: 'pending',
                value: undefined,
                error: undefined,
                refreshing: false,
            })
        }

        const generation = slot.generation
        const runLoad = (): Promise<T> =>
            (async () => {
                try {
                    const produced = (
                        preProduced === undefined ? await fn(slot.args) : await preProduced.produced
                    ) as T
                    if (slot.generation !== generation) return produced as T // superseded — discard silently
                    // See through a json()/jsonl()/sse() wrapper to its pre-encoding payload, so a wrapped result
                    // caches/streams exactly like the raw form (replayable-streams.md §4).
                    const tagged = responseSourceOf(produced)
                    // Streaming read: wrap the source in a ReplayableStream and resolve to it; the read maps that
                    // to a fresh `consume()` cursor per caller (see coalescedLoad/mapRead). The source runs once.
                    if (tagged?.kind === 'stream') {
                        return startStream(slot, tagged.source, tagged.encoding) as unknown as T
                    }
                    if (isStreamSource(produced)) {
                        return startStream(slot, produced) as unknown as T
                    }
                    const value = tagged?.kind === 'value' ? (tagged.value as T) : produced
                    slot.loadedAt = Date.now()
                    setState(slot, { status: 'value', value, error: undefined, refreshing: false })
                    recordAndEvict(slot, value)
                    return value
                } catch (caught) {
                    if (slot.generation === generation) {
                        slot.loadedAt = Date.now()
                        setState(slot, {
                            status: 'error',
                            value: undefined,
                            error: caught,
                            refreshing: false,
                        })
                    }
                    throw caught
                } finally {
                    if (slot.generation === generation) slot.inflight = null
                }
            })()

        // Fail-closed checkpoint (a), rpc-core §2: a shared handler runs OUTSIDE the request scope, so
        // identity()/cookies()/request()/context() throw if it touches request scope → the read rejects
        // (error slot) and the value is never cached, in dev AND prod. A nested non-shared memo lands in
        // the neutral default context. Non-shared memos keep running in the ambient scope.
        const promise = shared ? runOutsideScope(runLoad) : runLoad()

        slot.inflight = promise
        return promise
    }

    // On settle, record the value's JSON byte size and evict LRU entries over the ceiling — but only
    // for the two bounded server stores (shared + default context). No-op when unbounded.
    function recordAndEvict(slot: Slot<Args, T>, value: T): void {
        const store = boundedStore(slots())
        if (store === undefined) return
        sharedCacheRecordSize(store, slot.key, measureBytes(value))
        sharedCacheEvictIfNeeded(store)
    }

    // ---- AUTO-TRACKED fill (ADR 0024 §1-3) -------------------------------------------------------
    // The second fill path for the same slot. `fn` runs inside a `computed`, so every state it reads
    // synchronously becomes a declared input of this memo and a change to one is an ordinary re-fill.
    // Pull-based and lazy: nothing runs until something reads, and a read that follows a dependency write
    // in the same tick already sees the fresh value.

    function createAutoBacking(slot: Slot<Args, T>): AutoBacking<T> {
        const version = state(0)
        let runs = 0
        let ranOnce = false
        const fill = computed<AutoFill<T>>(() => {
            version() // subscribe: invalidate/refresh force a re-run with no dependency change
            runs++
            ranOnce = true
            let produced: Promise<T> | T
            try {
                produced = fn(slot.args)
            } catch (caught) {
                return {
                    run: runs,
                    state: {
                        status: 'error',
                        value: undefined,
                        error: caught,
                        refreshing: false,
                    },
                }
            }
            // A promise or a decoded-chunk source is NOT a synchronous derivation — hand it back for the
            // classic path (§2: half-tracked is worse than untracked, so an async body is not tracked at all).
            const tagged = responseSourceOf(produced)
            if (tagged?.kind === 'stream') return { run: runs, deferred: produced }
            if (isThenable(produced) || isStreamSource(produced)) {
                return { run: runs, deferred: produced }
            }
            const value = (tagged?.kind === 'value' ? tagged.value : produced) as T
            return {
                run: runs,
                state: { status: 'value', value, error: undefined, refreshing: false },
            }
        })
        const override = state<{ run: number; state: SlotState<T> } | null>(null)
        // An override survives only until the next fill. Reading `fill()` FIRST means a stale dependency is
        // recomputed (advancing `run`) before the stamps are compared, so a dependency change drops the
        // override in the same pull — "provisional until re-fill" (ADR 0024 §Context).
        const merged = computed<SlotState<T>>(() => {
            const base = fill()
            if ('deferred' in base) return idleState<T>()
            const current = override()
            return current !== null && current.run === base.run ? current.state : base.state
        })
        // A PER-REQUEST slot's backing must not outlive the request: its `fill` subscribes to whatever the
        // body read, which is often a MODULE-level `state` that lives for the whole process. The slots of a
        // long-lived context (client singleton / server default) are long-lived too, so they register nothing.
        if (!isBrowser && currentScope() !== undefined) {
            onContextDispose(() => {
                merged.dispose()
                fill.dispose()
            })
        }
        return { version, fill, override, merged, filled: () => ranOnce }
    }

    // Decide this slot's fill path, exactly once. Only the value the FIRST run produces distinguishes a
    // synchronous derivation from a promise/stream source (ADR 0024 §2), so the probe runs `fn` inside the
    // computed that would BE the auto backing — and when the run turns out deferred, the node is dropped
    // (leaving no dead observer edge) and its already-produced value goes straight to the classic load.
    function resolveMode(slot: Slot<Args, T>): void {
        if (!autoEligible || slot.modeResolved === true) return
        slot.modeResolved = true
        const backing = createAutoBacking(slot)
        // `peek` (not a tracked read): the probe establishes ITS OWN dependencies either way, and a caller
        // must not end up subscribed to a node we may be about to drop.
        const first = backing.fill.peek()
        if ('deferred' in first) {
            backing.fill.dispose()
            void startLoad(slot, false, { produced: first.deferred }).catch(() => {
                // The rejection is retained on the slot and re-thrown to whoever awaits the read.
            })
            return
        }
        slot.auto = backing
    }

    // The auto slot's live state — reactive (subscribes the caller to the memo's declared inputs).
    function autoState(auto: AutoBacking<T>): SlotState<T> {
        return auto.merged()
    }

    // Force the next pull to re-run `fn` even though no dependency changed (the auto analog of dropping a
    // slot to idle). `eager` additionally pulls right away, which is what makes `refresh` eager.
    function autoRefill(auto: AutoBacking<T>, eager: boolean): void {
        auto.override.set(null)
        auto.version.set(auto.version.peek() + 1)
        if (eager) auto.merged.peek()
    }

    // Remove a slot from the backing map entirely — distinct from dropSlot (which resets to idle but
    // KEEPS the slot so existing subscriptions stay live). Used for stream dispose-on-drain (§2): a
    // settled ttl:0 stream, or a stream every consumer abandoned, is gone and the next read is a cold run.
    function disposeSlot(slot: Slot<Args, T>): void {
        slot.generation++
        slot.inflight = null
        const cache = slots()
        const store = boundedStore(cache)
        if (store !== undefined) sharedCacheUnpin(store, slot.key) // never leave a disposed key pinned
        cache.delete(slot.key)
    }

    // Last consumer of a stream slot detached (ref-count hit 0). Dispose a settled ttl:0 slot; for a
    // still-open stream everyone abandoned, abort the source unless it is a retained (shared, ttl>0) run
    // that should complete for a late joiner (§2 empty-refcount policy).
    function onStreamRefCountZero(slot: Slot<Args, T>, stream: ReplayableStream<unknown>): void {
        // A stale callback (the slot already re-ran into a NEW stream under the same key) must not touch it.
        if (slot.state.peek().stream !== stream) return
        if (stream.settled) {
            // Dispose a ttl:0 slot, or an OVERFLOWED transcript (never retained for replay), on drain.
            if (ttl === 0 || stream.overflowed) disposeSlot(slot)
            return
        }
        if (!(shared && ttl > 0)) {
            stream.abort()
            disposeSlot(slot)
        }
    }

    // Wrap a streaming source in a ReplayableStream on the slot and pump the source into it exactly once.
    // Concurrent/late reads fan out via `consume()` (a fresh cursor each); the source is never re-run.
    function bumpStreamTick(slot: Slot<Args, T>): void {
        const tick = slot.streamTick
        if (tick !== undefined) tick.set(tick.peek() + 1)
    }

    // Incremental per-chunk accounting (replayable-streams.md §4): grow the slot's recorded size as the
    // transcript grows so an OPEN stream pressures the LRU live, and OVERFLOW past the per-stream cap so a
    // runaway can't grow unbounded. Only the two bounded server stores account; per-request/client don't.
    function accountStreamChunk(slot: Slot<Args, T>, stream: ReplayableStream<unknown>): void {
        if (slot.state.peek().stream !== stream) return // stale (slot re-ran)
        const store = boundedStore(slots())
        if (store === undefined) return
        if (stream.bytes > streamBufferCap()) {
            stream.markOverflowed() // abort + drop replay eligibility; buffer stops growing
            return
        }
        sharedCacheRecordSize(store, slot.key, stream.bytes)
        sharedCacheEvictIfNeeded(store) // evicts OTHER closed slots; this open stream is pinned
    }

    function startStream(
        slot: Slot<Args, T>,
        source: AsyncIterable<unknown> | Iterable<unknown>,
        encoding?: 'jsonl' | 'sse',
    ): ReplayableStream<unknown> {
        const controller = new AbortController()
        // A reactive tick for chunk-level probes (peek/chunks/done). Reused across re-runs of this slot.
        if (slot.streamTick === undefined) slot.streamTick = state(0)
        const stream = new ReplayableStream<unknown>({
            onAbort: () => controller.abort(),
            onRefCountZero: () => onStreamRefCountZero(slot, stream),
            onPush: () => {
                bumpStreamTick(slot)
                accountStreamChunk(slot, stream)
            },
        })
        stream.encoding = encoding // carried so the router re-serves the handler's chosen wire format
        // Pin an open stream against LRU eviction while it fills (bounded store only).
        const store = boundedStore(slots())
        if (store !== undefined) sharedCachePin(store, slot.key)
        setState(slot, {
            status: 'stream',
            value: undefined,
            error: undefined,
            refreshing: false,
            stream,
        })
        void (async () => {
            try {
                for await (const chunk of source) {
                    if (controller.signal.aborted) break
                    stream.push(chunk)
                }
                stream.close()
            } catch (caught) {
                stream.fail(caught)
            } finally {
                // Only touch the slot if it STILL holds this stream (not superseded by an invalidate/re-run).
                if (slot.state.peek().stream === stream) {
                    // TTL-from-close (§2): the retention clock starts when the transcript settles, not at fn-resolve.
                    slot.loadedAt = Date.now()
                    // The transcript is now a CLOSED value: unpin (LRU-evictable) and record its final size.
                    if (store !== undefined) {
                        sharedCacheUnpin(store, slot.key)
                        sharedCacheRecordSize(store, slot.key, stream.bytes)
                        sharedCacheEvictIfNeeded(store)
                    }
                }
                bumpStreamTick(slot) // reflect the terminal (done/error) to reactive probes
            }
        })()
        return stream
    }

    // Reactive-peek read path: subscribe to the slot, kick a coalesced load when cold or expired.
    function readReactive(slot: Slot<Args, T>): T | undefined {
        const state = slot.state()
        untrack(() => {
            if (slot.inflight !== null) return
            if (state.status === 'idle') {
                startLoad(slot, false)
            } else if (isExpired(slot)) {
                startLoad(slot, state.status === 'value')
            }
        })
        return state.value
    }

    // Reactive STREAM probe: subscribe to the state machine AND (while streaming) the chunk tick, kick a
    // cold load if idle, then project the live transcript via `select`. Returns undefined for a non-stream
    // / not-yet-streaming slot. Distinct from readReactive so it never restarts the bare `{#for await}`.
    function readStreamReactive<R>(
        slot: Slot<Args, T>,
        select: (chunks: readonly unknown[], stream: ReplayableStream<unknown>) => R,
    ): R | undefined {
        const state = slot.state()
        untrack(() => {
            if (slot.inflight === null && state.status === 'idle') startLoad(slot, false)
        })
        if (state.status !== 'stream' || state.stream === undefined) return undefined
        if (slot.streamTick !== undefined) slot.streamTick() // subscribe to chunk progress + terminal
        return select(state.stream.chunks, state.stream)
    }

    // A fresh per-consumer cursor over a shared stream, stamped with the handler's wire encoding so the
    // router re-serves jsonl/sse after replay.
    function streamCursor(stream: ReplayableStream<unknown>): T {
        const cursor = stream.consume()
        if (stream.encoding !== undefined) tagStreamEncoding(cursor, stream.encoding)
        return cursor as unknown as T
    }

    // A stream slot resolves (inflight or settled) to the SHARED ReplayableStream; each caller must get its
    // OWN cursor. mapRead turns that shared stream into a fresh `consume()` per read; a scalar passes through.
    function mapRead(resolved: T): T {
        return resolved instanceof ReplayableStream ? streamCursor(resolved) : resolved
    }

    // The coalesced-load core: return the in-flight promise, the settled value/error/stream cursor, or
    // start a load. Non-reactive on its own (uses `state.peek()`); the bare call adds the subscription.
    function coalescedLoad(slot: Slot<Args, T>): Promise<T> {
        const state = slot.state.peek()
        // A settled/open stream slot hands back a fresh cursor over the shared buffer with no re-run — unless
        // it OVERFLOWED (not a valid replay target), in which case fall through to a fresh run.
        if (
            state.status === 'stream' &&
            state.stream !== undefined &&
            !state.stream.overflowed &&
            !isExpired(slot)
        ) {
            return Promise.resolve(streamCursor(state.stream))
        }
        if (slot.inflight !== null) return slot.inflight.then(mapRead)
        if (!isExpired(slot)) {
            // A seed-primed / already-loaded slot resolves synchronously — tag the promise so attach-
            // hydration can claim the server-rendered `{#await fn()}` branch instead of re-mounting.
            if (state.status === 'value')
                return markSettled(Promise.resolve(state.value as T), state.value as T)
            if (state.status === 'error') return Promise.reject(state.error)
        }
        return startLoad(slot, state.status === 'value').then(mapRead)
    }

    // THE READ (Promise-read model): the bare call is the awaitable coalesced load AND subscribes the
    // calling reactive context to the slot (the tracked `slot.state()` read). So a reactive `{await
    // memo()}` / `{#await memo()}` re-runs and re-awaits when the slot invalidates — the crux the model
    // needed. The load itself runs untracked (it reads `state.peek()`), so only the subscription tracks.
    // An AUTO-TRACKED slot's bare read is the VALUE, not a promise (ADR 0024 §3), and an error state throws
    // where the classic path rejects — the synchronous analog.
    const c = ((args: Args) => {
        guardSharedRead()
        const slot = ensureSlot(args)
        resolveMode(slot)
        touchOnRead(slot)
        const auto = slot.auto
        if (auto !== undefined) {
            const state = autoState(auto)
            if (state.status === 'error') throw state.error
            return state.value as T
        }
        slot.state()
        return untrack(() => coalescedLoad(slot))
    }) as Memo<Args, T>

    // @deprecated alias for the bare call, minus the reactive subscription (back-compat during migration).
    c.load = (args: Args): Promise<T> => {
        guardSharedRead()
        const slot = ensureSlot(args)
        resolveMode(slot)
        touchOnRead(slot)
        const auto = slot.auto
        if (auto !== undefined) {
            const state = untrack(() => autoState(auto))
            if (state.status === 'error') return Promise.reject(state.error)
            const value = state.value as T
            return markSettled(Promise.resolve(value), value)
        }
        return coalescedLoad(slot)
    }

    // Reactive PEEK: the non-blocking snapshot — subscribes and kicks a coalesced load when cold. For a
    // VALUE slot: the current value (or undefined while pending). For a STREAM slot: the current value is
    // the MOST-RECENT chunk (replayable-streams.md §4), reactive on chunk arrival. Use `chunks()` for the
    // whole transcript.
    c.peek = (args: Args): T | undefined => {
        guardSharedRead()
        const slot = ensureSlot(args)
        resolveMode(slot)
        touchOnRead(slot)
        const auto = slot.auto
        if (auto !== undefined) return autoState(auto).value
        if (slot.state.peek().status === 'stream') {
            return readStreamReactive(slot, (chunks) =>
                chunks.length > 0 ? chunks[chunks.length - 1] : undefined,
            ) as T | undefined
        }
        return readReactive(slot)
    }

    // An auto-tracked fill is synchronous, so it is never pending and never revalidating over a stale value.
    c.pending = (args: Args): boolean => {
        const slot = ensureSlot(args)
        if (slot.auto !== undefined) return false
        return slot.state().status === 'pending'
    }

    c.error = (args: Args): unknown => {
        const slot = ensureSlot(args)
        resolveMode(slot)
        const auto = slot.auto
        if (auto !== undefined) return autoState(auto).error
        const state = slot.state()
        // A stream's error lives on the ReplayableStream, not the slot state; surface it reactively.
        if (state.status === 'stream' && state.stream !== undefined) {
            if (slot.streamTick !== undefined) slot.streamTick()
            return state.stream.error
        }
        return state.error
    }

    // Reactive stream probes (replayable-streams.md §4): full transcript snapshot, closed? (`peek()` above
    // gives the most-recent chunk — the "current value").
    c.chunks = (args: Args): unknown[] | undefined => {
        guardSharedRead()
        const slot = ensureSlot(args)
        if (slot.auto !== undefined) return undefined // a synchronous derivation has no transcript
        touchOnRead(slot)
        return readStreamReactive(slot, (chunks) => chunks.slice())
    }
    c.done = (args: Args): boolean => {
        guardSharedRead()
        const slot = ensureSlot(args)
        if (slot.auto !== undefined) return false
        touchOnRead(slot)
        return readStreamReactive(slot, (_chunks, stream) => stream.done) ?? false
    }

    c.resumeStream = (
        args: Args,
        from: number,
    ): { cursor: AsyncIterable<unknown> | undefined; fresh: boolean } => {
        guardSharedRead()
        const slot = ensureSlot(args)
        if (slot.auto !== undefined) return { cursor: undefined, fresh: true }
        const state = slot.state.peek()
        // A retained, non-overflowed transcript is resumable — replay from `from` then continue live.
        if (
            state.status === 'stream' &&
            state.stream !== undefined &&
            !state.stream.overflowed &&
            !isExpired(slot)
        ) {
            touchOnRead(slot)
            const cursor = state.stream.consume(from)
            // Stamp the wire encoding (as a fresh consume does) so the router re-serves a `?__abide_from=` resume
            // in the handler's ORIGINAL encoding (sse resumes as sse, jsonl as jsonl).
            if (state.stream.encoding !== undefined)
                tagStreamEncoding(cursor, state.stream.encoding)
            return { cursor, fresh: false }
        }
        return { cursor: undefined, fresh: true } // slot gone/evicted → caller runs fresh from 0
    }

    c.refreshing = (args: Args): boolean => {
        const slot = ensureSlot(args)
        if (slot.auto !== undefined) return false
        return slot.state().refreshing
    }

    c.refresh = (args?: Partial<Args> | Args): void => {
        const slots = selectSlots(args)
        log.channel('abide:memo').trace(`refresh ${id} (${slots.length} slots)`)
        for (const slot of slots) {
            const auto = slot.auto
            if (auto !== undefined) autoRefill(auto, true)
            else startLoad(slot, true)
        }
        broadcast('refresh', args)
    }

    // Drop one slot back to idle: bump generation so a superseded in-flight load discards its result,
    // clear coalescing, and notify subscribers by resetting the (retained) state to idle -> lazy
    // reload on next read. The slot stays in the map so existing subscriptions stay live.
    function dropSlot(slot: Slot<Args, T>): void {
        const auto = slot.auto
        if (auto !== undefined) {
            autoRefill(auto, false) // lazy: re-runs `fn` on the next pull
            return
        }
        const state = slot.state.peek()
        // Invalidating an OPEN stream aborts its source and gracefully ends live consumers (§4) — a value
        // slot has nothing to tear down.
        if (state.status === 'stream' && state.stream !== undefined && !state.stream.settled) {
            state.stream.abort()
        }
        slot.generation++
        slot.inflight = null
        slot.loadedAt = 0
        setState(slot, idleState<T>())
    }

    c.invalidate = (args?: Partial<Args> | Args): void => {
        const slots = selectSlots(args)
        log.channel('abide:memo').trace(`invalidate ${id} (${slots.length} slots)`)
        for (const slot of slots) dropSlot(slot)
        broadcast('invalidate', args)
    }

    c.publish = (args: Args, next: T | ((current: T | undefined) => T)): void => {
        const slot = ensureSlot(args)
        resolveMode(slot)
        const auto = slot.auto
        if (auto !== undefined) {
            // The auto-tracked write (ADR 0024 §4): stamp the run being overridden, so the next re-fill of
            // any declared input drops it. `fill.peek()` pulls a stale fill first, so the updater form and
            // the stamp both see the CURRENT run.
            const base = auto.fill.peek()
            const current = untrack(() => autoState(auto))
            const value =
                typeof next === 'function'
                    ? untrack(() => (next as (current: T | undefined) => T)(current.value))
                    : next
            auto.override.set({
                run: base.run,
                state: { status: 'value', value, error: undefined, refreshing: false },
            })
            log.channel('abide:memo').trace(`publish ${id}`)
            broadcast('publish', args, value)
            return
        }
        const current = slot.state.peek()
        let value: T
        if (typeof next === 'function') {
            // Updater-form. A closure can't cross the wire (rpc-core §2 tension): on a SHARED slot the
            // updater runs against the durable value here, then broadcasts its RESULT as a value-form
            // frame. A SERVER per-request (non-shared) slot inside a request scope has nothing durable to
            // broadcast an updater against → error. On the client (or a bare/default-context server call
            // with no request scope), an updater-form publish stays a local mutation.
            if (!shared && !isBrowser && currentScope() !== undefined) {
                throw new Error(
                    'publish updater-form is not supported on a per-request memo; pass a value instead',
                )
            }
            value = untrack(() => (next as (current: T | undefined) => T)(current.value))
        } else {
            value = next
        }
        setState(slot, { status: 'value', value, error: undefined, refreshing: current.refreshing })
        log.channel('abide:memo').trace(`publish ${id}`)
        // Both forms broadcast the resolved VALUE (value-form frame) on a shared slot.
        broadcast('publish', args, value)
    }

    c.snapshot = (): Array<{ args: Args; value: T }> =>
        untrack(() => {
            const result: Array<{ args: Args; value: T }> = []
            for (const slot of selectSlots(undefined)) {
                const auto = slot.auto
                if (auto !== undefined) {
                    // Report an auto slot only once something has actually pulled it — reading it here would
                    // otherwise RUN `fn` for every cold derivation just to collect the seed.
                    if (!auto.filled()) continue
                    const state = auto.merged.peek()
                    if (state.status === 'value')
                        result.push({ args: slot.args, value: state.value as T })
                    continue
                }
                const state = slot.state.peek()
                if (state.status === 'value')
                    result.push({ args: slot.args, value: state.value as T })
            }
            return result
        })

    c.seed = (args: Args, value: T): void => {
        const slot = ensureSlot(args)
        // A seeded auto slot takes the value as a provisional override (identical to `publish`) — the
        // derivation still owns it and re-fills on the next dependency change.
        if (slot.auto !== undefined) {
            c.publish(args, value)
            return
        }
        slot.loadedAt = Date.now()
        setState(slot, { status: 'value', value, error: undefined, refreshing: false })
    }

    // The WRITABLE PROJECTION (ADR 0024 §4). `set` IS `publish`, so a local write holds until the next
    // re-fill — the whole of the retired `state.linked`. Reading is `peek` semantics (reactive,
    // non-blocking); the blocking reads stay on the memo itself.
    c.state = (args: Args): State<T> => {
        const cell = (() => c.peek(args) as T) as State<T>
        cell.set = (value: T) => c.publish(args, value)
        cell.peek = () => untrack(() => c.peek(args)) as T
        return cell
    }

    c.seedStream = (
        args: Args,
        source: readonly unknown[] | AsyncIterable<unknown>,
        encoding?: 'jsonl' | 'sse',
    ): void => {
        // Pump the SSR handoff through `startStream` — it wraps the source in a ReplayableStream and
        // installs the slot. A finite array (mode A) closes immediately (stamps the close clock); an
        // AsyncIterable (mode B: prefix then resumed tail) stays open until it ends, then closes. Either
        // way a later read hands back a cursor with NO source run; `peek`/`chunks`/`done`/`refresh` then
        // behave exactly as for a client-loaded stream.
        const slot = ensureSlot(args)
        startStream(slot, source, encoding)
    }

    c.watch = (args: Args, handler: (value: T | undefined) => void): (() => void) => {
        const slot = ensureSlot(args)
        resolveMode(slot)
        let first = true
        let last: T | undefined
        const auto = slot.auto
        if (auto !== undefined) {
            // Auto-tracked: the effect subscribes to the memo's declared inputs through `merged`, so a
            // dependency change delivers exactly like an invalidate-driven re-fill does on a classic slot.
            return effect(() => {
                const value = autoState(auto).value
                if (first) {
                    first = false
                    last = value
                    return
                }
                if (value === last) return
                last = value
                untrack(() => handler(value))
            })
        }
        // Chunk count for a STREAM slot. An append advances it; the terminal ALSO bumps the tick
        // (see startStream's finally) but does not advance the count — so settling never re-delivers a
        // chunk the handler already saw.
        let lastCount = 0
        return effect(() => {
            const state = slot.state()
            // STREAM slot: `value` is permanently undefined here (§4), so the scalar path below could
            // never fire — `watch` was silently dead on every stream and socket. Subscribe to the
            // per-chunk tick and deliver the LATEST chunk, the same "current value" meaning `peek`
            // already carries for a stream (and the same cast precedent). Effect runs are COALESCED:
            // several appends inside one flush deliver once, with the newest chunk — `watch` reports
            // *that it changed*; iterate the stream when you need every chunk.
            if (state.status === 'stream' && state.stream !== undefined) {
                if (slot.streamTick !== undefined) slot.streamTick()
                const chunks = state.stream.chunks
                const count = chunks.length
                const latest = (count > 0 ? chunks[count - 1] : undefined) as T | undefined
                if (first) {
                    first = false
                    lastCount = count
                    last = latest
                    return
                }
                if (count === lastCount) return
                lastCount = count
                last = latest
                untrack(() => handler(latest))
                return
            }
            const value = state.value
            // Fire ONLY on an actual value change — not on non-value transitions (e.g. `refresh` flips
            // the `refreshing` flag on over the retained value, then settles the new one: the flag flip
            // isn't a value change, so a refresh that lands one new value fires the handler once).
            if (first) {
                first = false
                last = value
                return
            }
            if (value === last) return
            last = value
            untrack(() => handler(value))
        })
    }

    // Tag registry hooks (rpc-core §8, PR4). A shared memo carrying tags registers these so the global
    // `invalidate/refresh({ tags })` selectors can act on it. Tag invalidate/refresh act on ALL current
    // slots and broadcast PER SLOT on that slot's `(rpc,args)` channel (unlike a bare-args verb, which
    // broadcasts once for the selector) so per-args subscribers each receive their own frame. pending/
    // refreshing are LOCAL reactive aggregates over the memo's current slot states — no broadcast.
    function invalidateForTags(): void {
        for (const slot of selectSlots(undefined)) {
            dropSlot(slot)
            broadcast('invalidate', slot.args)
        }
    }
    function refreshForTags(): void {
        for (const slot of selectSlots(undefined)) {
            startLoad(slot, true)
            broadcast('refresh', slot.args)
        }
    }
    function anyPendingForTags(): boolean {
        let any = false
        for (const slot of selectSlots(undefined)) {
            if (slot.state().status === 'pending') any = true
        }
        return any
    }
    function anyRefreshingForTags(): boolean {
        let any = false
        for (const slot of selectSlots(undefined)) {
            if (slot.state().refreshing) any = true
        }
        return any
    }

    if (shared && tags.length > 0) {
        registerTaggedMemo({
            tags,
            invalidate: invalidateForTags,
            refresh: refreshForTags,
            pending: anyPendingForTags,
            refreshing: anyRefreshingForTags,
        })
    }

    return c
}
