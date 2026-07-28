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
// tracking context subscribes; resolve/invalidate/publish re-run subscribers ONLY when the write
// is observable — an idempotent one hands back the state object it already held (see `setState`).
// The slot is a state machine idle -> pending -> value | error; pending/error/peek are derived
// views of that one state.
//
// `refreshing` is the exception: its own signal on the slot, not a field of the envelope, because
// value and status are two AXES. A keepStale refresh flips it on and back while the value stays
// put, and folding it into the envelope woke every VALUE reader twice per refresh to report that
// a spinner had come and gone.
//
// The opt-in server CROSS-REQUEST cache (`memo: { crossRequest: true }`, rpc-core §2) is wired
// here: a shared memo stores its slots in the process-global `sharedStore()` and runs its handler
// fail-closed (scope-exited + ambient-guarded), server-only. A crossRequest memo's verbs also fire an
// injectable, TRANSPORT-FREE `notify` sink (rpc-core §8 broadcast, PR2): the memo just calls it —
// `createApp` binds it to the actual channel publish (the memo never imports transport). A crossRequest
// memo declaring `tags` (PR4) registers itself in the server tag registry so the global
// `invalidate/refresh({ tags })` selectors can drop/revalidate + broadcast its slots. TODO (later
// PRs): the client-side channel join/apply.

import { canonicalKey } from './internal/codec.ts'
import { isBrowser } from './internal/isBrowser.ts'
import { isTimeoutError } from './internal/isTimeoutError.ts'
import { registerTaggedMemo } from './internal/memoTags.ts'
import { positiveEnvBytes } from './internal/positiveEnvBytes.ts'
import { type Computed, computed, effect, type State, state, untrack } from './internal/reactive.ts'
import type { ReactiveReadSurface } from './internal/reactiveReadSurface.ts'
import {
    exitScope,
    onScopeDispose,
    reactiveScope,
    serverDefaultScope,
} from './internal/reactiveScope.ts'
import { ReplayableStream } from './internal/replayableStream.ts'
import { responseSourceOf, tagStreamEncoding } from './internal/responseSource.ts'
import type { Room } from './internal/room.ts'
import { markSettled } from './internal/settledRead.ts'
import {
    sharedCacheEvictIfNeeded,
    sharedCachePin,
    sharedCacheRecordSize,
    sharedCacheTouch,
    sharedCacheUnpin,
    sharedStore,
} from './internal/sharedCache.ts'
import { tagStreamTranscript } from './internal/streamTranscript.ts'
import { withDeadline } from './internal/withDeadline.ts'
import { log } from './log.ts'

// `crossRequest` is a SERVER concept (cross-request store + scope isolation). On the client a
// crossRequest-flagged memo behaves like a normal client memo, so every crossRequest-only branch below
// is gated on `!isBrowser`.

// "stream" is the streaming-read slot (replayable-streams.md §4): the resolved value is not a scalar
// but a ReplayableStream the read fans out via `consume()`. Scalar (`value`) and stream slots stay
// monomorphic in their own field — a stream slot's `value` is always undefined and vice versa.
type Status = 'idle' | 'pending' | 'value' | 'error' | 'stream'

// One immutable snapshot of a slot's state. Held inside the slot state, and NEVER mutated in place —
// which is what lets `setState` hand the SAME object back when a transition is observably a no-op, so
// the state's `===` comparison does not fire and no reader wakes. Replacing it with a fresh object on
// every transition is the bug, not the contract: identity is the propagation cutoff.
interface SlotState<T> {
    status: Status
    value: T | undefined
    error: unknown
    // Set only when status === "stream": the shared replay buffer this slot fans out (§4).
    stream?: ReplayableStream<unknown>
}

// The idle clock behind a streaming run's deadline (ADR 0028 D1). One timer for the whole stream,
// restarted in place on every chunk via `refresh()` — no allocation per chunk, and `unref` so a stream
// awaiting its next chunk never by itself holds the process open (which would break `abide run` and any
// short-lived script). `ms` of 0 arms nothing and hands back inert no-ops, so an unbounded stream pays
// neither the timer nor a branch per chunk beyond one already-monomorphic call.
function armStreamDeadline(ms: number, onIdle: () => void): { progress(): void; cancel(): void } {
    if (!Number.isFinite(ms) || ms <= 0) return INERT_STREAM_DEADLINE
    let timer = setTimeout(onIdle, ms)
    timer.unref?.()
    // `refresh()` restarts a timer IN PLACE, which is what keeps a hot stream from allocating one per
    // chunk — but it is a Node/Bun `Timeout` method and this module is ISOMORPHIC: in the browser
    // `setTimeout` returns a number, `timer.refresh()` throws, and the throw lands in the pump's catch,
    // which fails the transcript. That is a whole-stream break with a per-chunk cause, and no unit test
    // sees it (happy-dom takes the same server path) — the docs-app e2e suite is what caught it. So the
    // capability is probed ONCE here and each branch stays monomorphic, rather than re-arming blindly
    // on the server too.
    const refreshable = typeof (timer as { refresh?: unknown }).refresh === 'function'
    return {
        progress: refreshable
            ? () => {
                  timer.refresh()
              }
            : () => {
                  clearTimeout(timer)
                  timer = setTimeout(onIdle, ms)
              },
        cancel: () => {
            clearTimeout(timer)
        },
    }
}

const INERT_STREAM_DEADLINE = { progress: (): void => {}, cancel: (): void => {} }

interface Slot<Args, T> {
    args: Args
    // Own signal, deliberately NOT a field of `state`. A `keepStale` refresh flips this on and back
    // while the value stays put; carrying it inside the state envelope meant every such flip rebuilt
    // the envelope and woke everyone reading the VALUE, twice per refresh, to report that a spinner
    // had come and gone. Separate signals mean a probe wakes for its own axis and no other.
    refreshing: State<boolean>
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
    // SETTLED BUT IMMEDIATELY EXPIRED — how a timed-out run is retained (ADR 0028 D7). `fn.error()` reads
    // the slot state with no expiry check, while the read path gates its cached rejection behind
    // `isExpired`, so this flag keeps the TimeoutError visible to probes while the very next read runs
    // cold. Disposing the slot instead would blank `fn.error()` at once and an error banner would flash
    // and vanish, and a `loadedAt` stamp cannot express it: `isExpired` short-circuits on `ttl ===
    // Infinity` before consulting the clock, and `Infinity` is exactly a read's default ttl.
    expired: boolean
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

// SERVER-ONLY broadcast sink (rpc-core §8, PR2). A crossRequest memo calls this when a verb changes a
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
    // crossRequest-flagged client memo behaves like a normal client memo). Slots live in the
    // process-global `sharedStore()` keyed only by args — safe ONLY for functions pure over their args.
    // Enforced fail-closed: the handler runs outside the request scope and a read requires an active one.
    //
    // NAMED `crossRequest`, not `shared` (ADR 0027 D5). `state.shared(key)` is the other `shared`, and
    // the two were exact MIRROR IMAGES on the isomorphism axis — `state.shared` is client-real and
    // server-degraded (cross-instance + cross-tab), this one is server-real and client-inert
    // (cross-request). A reader who learned one had learned the opposite of the other. `state.shared`
    // keeps the plain-English name because a reader guesses it correctly unaided; the escape from the
    // request deserves a name that SAYS it escapes, since it is the dangerous-if-impure one.
    crossRequest?: boolean
    // SERVER-ONLY broadcast sink (rpc-core §8, PR2). Only invoked on a `crossRequest` memo — a
    // request-scoped memo never broadcasts even if a sink is present. Injected transport-free;
    // `createApp` binds it.
    notify?: MemoNotify
    // Cache tags (rpc-core §8, PR4). Server-only and honored ONLY on a `crossRequest` memo: the memo
    // registers under each tag so the global `invalidate/refresh({ tags })` selectors can drop/
    // revalidate + broadcast its slots. Inert on the client and on a request-scoped memo.
    tags?: string[]
    // The RUN DEADLINE in ms (ADR 0028). Owned here because the memo owns the run: a deadline enforced
    // at any caller would give two callers of one coalesced slot divergent outcomes, which is exactly
    // what `setState`'s one-state-one-wake-up contract forbids. Measures time WITHOUT PROGRESS (D1) —
    // for a value that is time-to-settle, for a stream time-to-first-chunk and then the inter-chunk gap.
    //
    // Absent/0/Infinity = unbounded, and a plain `memo(...)` derivation defaults to exactly that: the
    // 5-minute `ABIDE_RPC_TIMEOUT` ceiling is an RPC policy, resolved in `makeRpc`, not a property of
    // memoization. A derivation that reads three cells has no run to bound.
    timeout?: number
    // INTERNAL (set by `makeRpc`, never by an author): this memo wraps a LOADER — an rpc handler —
    // rather than a derivation. An async body is the expected shape for a loader, so the auto-tracking
    // diagnostic (ADR 0027 D8) does not apply and would fire on every zero-arg rpc as pure noise.
    // Explicit rather than inferred from `notify`: keying a diagnostic off an unrelated field is the
    // implicit coupling this ADR exists to remove.
    loader?: boolean
}

// Options an AUTO-TRACKED memo may carry (ADR 0024 §1-3). `ttl` and `crossRequest` are retention policies
// for a PULLED value; a synchronous derivation has nothing to retain and no cross-request identity, so
// naming either one is what opts a memo back onto the classic promise path — the type and the runtime
// classifier agree on that (see the overloads on `memo`).
export type SyncMemoOptions = Omit<MemoOptions, 'ttl' | 'crossRequest'>

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
    // memo-specific. The key stays a `Room` positional, so an ARGLESS memo publishes bare — `m.publish(v)`,
    // no `undefined` placeholder — while a keyed one names its slot: `m.publish({id}, v)`.
    publish(...args: [...Room<Args>, next: T | ((current: T | undefined) => T)]): void
    // The generic-safe two-argument form (see `ReactiveReadSurface.publish`).
    publish(args: Args, next: T | ((current: T | undefined) => T)): void
    // The WRITABLE PROJECTION of one slot (ADR 0024 §4) — and only that; reading a memo is the bare call,
    // `{…}`, `.peek()` and `await`, which already have defined blocking behaviour. The returned cell reads
    // the slot reactively (`.peek()` semantics) and its `set` IS `publish`, so a local write is provisional
    // until the next re-fill. That is the whole of the retired `state.linked`.
    //
    // The INITIAL is required here and the key is a `Room` positional (ADR 0027 D7): `m.state(initial)`
    // when nothing was declared, `m.state({ id }, initial)` when it was. An async slot can be COLD, where
    // `peek` is `undefined` — and `State<T>` is invariant across read and write, so widening it to
    // `State<T | undefined>` would also widen `set`, letting a local write forge the very sentinel that
    // means "not loaded" (`publish` takes `next: T` for exactly that reason). The initial closes the hole
    // instead of moving it: the cell reads `peek(args) ?? initial`, so it is genuinely `T`. This also makes
    // the sibling relationship exact — `state(initial)` has always required one, and an owned writable cell
    // with no value was the anomaly. `SyncMemo`/`SyncKeyedMemo` override it away (see below).
    //
    // `state` is the THIRD verb with a trailing payload, after `publish` and `watch`. The rule, stated
    // once: every verb with a trailing payload takes the key as a `Room` positional.
    // NB: no generic-safe two-argument overload here, unlike `publish`/`watch`. That form exists on those
    // two because the client proxy and the broadcast-frame applier forward an UNRESOLVED `Args` and cannot
    // spread a deferred conditional tuple. Nothing forwards `state` — it is only ever called on a memo
    // whose `Args` is concrete — so the extra overload would buy nothing and it is what makes the
    // `SyncMemo`/`SyncKeyedMemo` narrowings below unrepresentable.
    state(...args: [...Room<Args>, initial: T]): State<T>
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
    // is a completed (mode-A) transcript; a `StreamSeed` is the mode-B flushed-prefix + resumed-tail pair;
    // a bare AsyncIterable is any other warm source (it closes the slot when it ends).
    seedStream(
        args: Args,
        source: readonly unknown[] | AsyncIterable<unknown> | StreamSeed,
        encoding?: 'jsonl' | 'sse',
    ): void
}

// A mode-B (OPEN) SSR handoff: the flushed `prefix` is already known, `rest` resumes the tail over the
// wire. Kept as its own shape rather than one pre-concatenated generator so `startStream` can push the
// prefix SYNCHRONOUSLY — attach-hydration reads the transcript in the SAME TICK to bind each painted
// item's value and claim the server's nodes, and a generator's first yield is already a microtask late.
export interface StreamSeed {
    prefix: readonly unknown[]
    rest: AsyncIterable<unknown>
}

// A `StreamSeed` vs a bare iterable source. Keyed on the `prefix` array rather than on the ABSENCE of
// `Symbol.asyncIterator`, so a source that happens to carry both is still read as the explicit seed.
function isStreamSeed(source: unknown): source is StreamSeed {
    return (
        typeof source === 'object' &&
        source !== null &&
        Array.isArray((source as StreamSeed).prefix)
    )
}

// An AUTO-TRACKED memo: `fn` declares no inputs and produces a plain value synchronously, so its
// dependencies are inferred from the body (ADR 0024 §1-2) and THE BARE CALL RETURNS `T`, NOT `Promise<T>`
// (§3 — a promise-returning read would blank the server-rendered text and refill it a microtask later,
// because `interpolate` clears the node before awaiting a thenable). This is the retired `state.computed`;
// `.state()` makes it writable and is the retired `state.linked`.
//
// The slot is keyed by no args, so every probe/verb inherited from `Memo<void, T>` is callable bare
// (`peek()`, `refresh()`, `invalidate()`, `state()`) — a `void` parameter may be omitted.
export interface SyncMemo<T> extends Memo<void, T> {
    (): T
    // NO initial (ADR 0027 D7). A sync memo has no cold hole to fill: it is never `pending` (its fill is
    // synchronous) and a throwing body RETHROWS on read rather than yielding `undefined`, so the read is
    // `T`-or-throw and `State<T>` is already sound. An `initial` here would be dead weight the author
    // could never observe. Declared OPTIONAL rather than absent because the base signature is a rest
    // TUPLE, which TypeScript compares element-by-element — a strictly-shorter override is not assignable
    // to it, where an optional trailing parameter is.
    state(initial?: T): State<T>
}

// A KEYED memo whose body is SYNCHRONOUS. Args are still the whole dependency set (the body runs
// untracked, one slot per key), but there is nothing to await, so the bare call returns `T` — same
// reasoning as `SyncMemo`: a promise here would blank the server-rendered text and refill it a microtask
// later. Every probe/verb is inherited unchanged; only the read differs.
export interface SyncKeyedMemo<Args, T> extends Memo<Args, T> {
    (args: Args): T
    // Keyed, but still synchronous — so the key stays and the initial becomes optional (see `SyncMemo`).
    state(...args: [...Room<Args>, initial?: T]): State<T>
}

// Excludes a DEFERRED body from the synchronous overload: inference sets `T` from the body's return, and a
// promise or an async iterable collapses to `never`, which the body is not assignable to — so the call
// falls through to the loading overload instead. A stream body is deferred too: an async generator is not
// a `Promise`, and a keyed stream slot belongs to the replayable-transcript path, not this one.
type NotDeferred<T> = T extends Promise<unknown> | AsyncIterable<unknown> ? never : T

// Sentinel for "this keyed read is not synchronous after all" — distinct from any value a body may return,
// including `undefined`.
const DEFERRED: unique symbol = Symbol('abide.memo.deferred')

let memoCounter = 0

function idleState<T>(): SlotState<T> {
    return { status: 'idle', value: undefined, error: undefined }
}

// Do two slot states describe the same observable read? Used to keep a derived value's identity STABLE
// across a re-run that produced the same result, which is what lets the reactive graph cut propagation
// (see `merged`). `value` is compared by IDENTITY, exactly like every other derived primitive: a body
// that hands back a fresh object each run genuinely may have changed, and guessing otherwise would drop
// real updates. `SlotState` is always replaced, never mutated in place, so sharing one is safe.
function sameSlotState<T>(a: SlotState<T>, b: SlotState<T>): boolean {
    return (
        a.status === b.status && a.value === b.value && a.error === b.error && a.stream === b.stream
    )
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
// The TWO-ARGUMENT form (ADR 0024 §1, ADR 0025): the source THUNK is the declared input, so only it is
// tracked and the transform runs untracked — the same rule and mechanism as `watch(source, handler)`.
// The source is always a thunk, which is what makes the tracked region a plain lexical thing you can see:
// several inputs need no API of their own, they are just what the thunk returns (`() => ({ a, b })`).
export function memo<S, T>(
    source: () => S,
    transform: (value: S) => T,
    opts?: SyncMemoOptions,
): SyncMemo<T>
// KEYED + SYNCHRONOUS: the args are the cache key and the whole dependency set, and the read IS the value.
// Declared before the loading overload so a plain-valued body picks it; a promise-returning body fails
// `NotPromise` and falls through.
export function memo<Args, T>(
    fn: (args: Args) => NotDeferred<T>,
    opts?: SyncMemoOptions,
): SyncKeyedMemo<Args, T>
export function memo<Args, T>(fn: (args: Args) => Promise<T> | T, opts?: MemoOptions): Memo<Args, T>
// One runtime object serves every overload — the auto-tracked path is a second FILL PATH for the same
// slot, not a second surface (ADR 0024 §3), so the implementation signature just spans both faces.
export function memo<Args, T>(
    body: (args: Args) => Promise<T> | T,
    transformOrOpts?: ((value: never) => unknown) | MemoOptions,
    trailingOpts?: MemoOptions,
): Memo<Args, T> | SyncMemo<T> | SyncKeyedMemo<Args, T> {
    const transform =
        typeof transformOrOpts === 'function'
            ? (transformOrOpts as unknown as (value: unknown) => T)
            : undefined
    const opts: MemoOptions | undefined =
        transform === undefined ? (transformOrOpts as MemoOptions | undefined) : trailingOpts
    // The two forms are disjoint and the SECOND argument tells them apart: an object is options and the
    // body is an args-keyed loader (what an RPC builds); a function is a transform and the body must then
    // be the argless SOURCE THUNK (ADR 0025). Pairing an args-taking body with a transform is neither —
    // it would call the handler with no arguments and memoize the result under one slot.
    if (transform !== undefined && body.length > 0) {
        throw new TypeError(
            'memo: a source paired with a transform must be an ARGLESS thunk (ADR 0025) — ' +
                '`memo(() => …, transform)`. A handler that takes args is the KEYED form, and it pairs ' +
                'with options, not a transform.',
        )
    }
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
    // 0 = unbounded (ADR 0028 D9's declared opt-out and a plain derivation's default alike), which is
    // what `withDeadline` and the stream watchdog both read as "arm nothing".
    const timeoutMs = opts?.timeout ?? 0
    const id = opts?.key ?? `memo#${++memoCounter}`
    // `crossRequest` is server-only; on the client it is inert (falls through to the client cache).
    const crossRequest = opts?.crossRequest === true && !isBrowser
    const notify = opts?.notify
    // Tags are honored only on a crossRequest (server) memo — the tag registry is a server concept.
    const tags = crossRequest ? (opts?.tags ?? []) : []

    // Could this memo take the AUTO-TRACKED path (ADR 0024 §1-2)? Only an argless `fn` declares no inputs,
    // and only a memo with no retention policy has nothing to retain: an explicit `ttl` (including the
    // `ttl: 0` a `memo: false` read compiles to) or `crossRequest: true` keeps the classic pulled machinery,
    // which is also what the `SyncMemoOptions` overload encodes so types and runtime cannot disagree.
    // Whether it ACTUALLY takes it is decided by the first run — see `resolveMode`.
    const autoEligible = fn.length === 0 && ttl === Infinity && !crossRequest

    // ADR 0027 D8 — the auto-tracking diagnostic.
    //
    // An argless memo declares NO inputs, so whether it is reactive is decided by what its body
    // RETURNS: a synchronous value is auto-tracked, a promise is not (§2 — half-tracked is worse than
    // untracked). That choice is correct and stays. What was wrong is that it was made SILENTLY, on the
    // highest-stakes axis in the model: adding one `await` to a working derivation converts it into a
    // manually-invalidated cache that never updates again, and nothing anywhere says so. Note the
    // asymmetry this fixes — the LESS consequential misclassification (`fn.length`, just below) already
    // throws; the one that silently costs you reactivity said nothing.
    //
    // Fires at most once per memo, on the first run that proves the body async. Not an error: both paths
    // are legal and useful, and the fix is a one-liner the message names — declare the inputs
    // (`memo(() => ({ a, b }), async ({ a, b }) => …)`, ADR 0025), which tracks the thunk and runs the
    // async transform untracked. Undiscoverable, though, if you never learn you lost something.
    let warnedUntracked = false
    const warnUntracked = (produced: string): void => {
        if (warnedUntracked || opts?.loader === true) return
        warnedUntracked = true
        log.channel('abide:memo').warn(
            `memo ${id}: an argless memo whose body returns ${produced} is NOT auto-tracked — ` +
                'its dependencies are not observed, so it re-fills only on refresh()/invalidate(). ' +
                'To track inputs, declare them: memo(() => ({ a, b }), async ({ a, b }) => …).',
        )
    }
    // A KEYED body can also be synchronous, and then the read IS the value — there is nothing to await, and
    // handing back a promise would blank the SSR text and refill it a microtask later (the same reasoning as
    // ADR 0024 §3). It does NOT get the auto-tracked backing: its args are the whole dependency set, so the
    // body runs untracked and the value lives in the ordinary slot state machine, which is what keeps a
    // hydration `seed`, a `publish`, and `invalidate` authoritative over it.
    const keyedSyncEligible = fn.length > 0 && ttl === Infinity && !crossRequest
    // Undecided until the first run proves it, exactly like `resolveMode`.
    let keyedSync: boolean | undefined
    if (fn.length === 0 && declaresParameters(fn)) {
        throw new TypeError(
            'memo: a rest or defaulted parameter (`(...args) => …` / `(args = {}) => …`) reports ' +
                'fn.length 0, which would silently reclassify this args-keyed memo as auto-tracked. ' +
                'Name the parameter without a default, or destructure with per-field defaults ' +
                '(`({ n = 0 }) => …`).',
        )
    }

    // Fire the broadcast sink for a slot-changing verb — ONLY on a crossRequest memo (broadcast is a
    // cross-request-slot concept). Transport-free: the memo just calls the injected function.
    function broadcast(
        verb: 'invalidate' | 'refresh' | 'publish',
        args: unknown,
        value?: unknown,
    ): void {
        if (crossRequest && notify !== undefined) notify(verb, args, value)
    }
    // Namespace slots within the backing cache map. \x00 keeps the prefix distinct from any
    // canonicalKey output.
    const prefix = `\x00memo\x00${id}\x00`

    // The cache Map backing this memo's slots: the process-global shared store for a `crossRequest` memo,
    // otherwise the ambient per-context cache (per-request on the server, singleton on the client).
    function slots(): Map<string, unknown> {
        return crossRequest ? sharedStore() : reactiveScope().slots
    }

    // The LRU-bounded store backing `cache`, if any. Only the shared store and the persistent server
    // default scope are bounded by ABIDE_MAX_SHARED_CACHE_SIZE; per-request caches die with the
    // request and the client cache dies with the tab, so neither is bounded.
    function boundedStore(cache: Map<string, unknown>): Map<string, unknown> | undefined {
        if (isBrowser) return undefined
        if (cache === sharedStore() || cache === serverDefaultScope()?.slots) return cache
        return undefined
    }

    // Fail-closed checkpoint (b), rpc-core §2: a crossRequest read must run inside an active request scope
    // (an authorized caller). A bare script/cron read has no gate and no client to serve, so it
    // throws rather than silently touching the cross-request store. Server-only; inert on the client.
    function guardSharedRead(): void {
        if (crossRequest && reactiveScope().requestScoped !== true) {
            throw new Error('crossRequest memo read requires an active request scope')
        }
    }

    // Move a bounded slot to MRU on read so LRU eviction drops least-recently-read first.
    function touchOnRead(slot: Slot<Args, T>): void {
        if (!crossRequest && isBrowser) return
        const store = boundedStore(slots())
        if (store !== undefined) sharedCacheTouch(store, slot.key)
    }

    // THIS memo's own slots within one backing store, so a verb never has to scan the whole store.
    // Keyed by the store Map itself (as `sharedCache`'s sidecars are), which makes the index per-request
    // on the server and per-tab on the client, and lets it die with the store it indexes.
    const ownSlots = new WeakMap<Map<string, unknown>, Map<string, Slot<Args, T>>>()

    function ownSlotsIn(cache: Map<string, unknown>): Map<string, Slot<Args, T>> {
        let own = ownSlots.get(cache)
        if (own === undefined) {
            own = new Map<string, Slot<Args, T>>()
            ownSlots.set(cache, own)
        }
        return own
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
                refreshing: state(false),
                inflight: null,
                loadedAt: 0,
                generation: 0,
                expired: false,
            }
            cache.set(slotKey, slot)
            ownSlotsIn(cache).set(slotKey, slot)
        }
        return slot
    }

    // Every slot belonging to this memo in the active context (optionally filtered by selector).
    //
    // Reads the memo's OWN index rather than scanning the backing store: the store holds every memo's
    // slots for the whole request, so scanning it made each verb O(all slots in the context) — and
    // `snapshot()` is called once per read route by the SSR seed collector, which turned that into
    // O(routes x slots) per page render.
    //
    // The index is a cache, not the truth: `sharedCacheEvictIfNeeded` deletes from the store directly
    // (LRU), so an indexed slot can already be gone. Each entry is confirmed against the store by
    // identity and a stale one is dropped here — one Map lookup per OWN slot, still nothing per foreign
    // slot. Confirming by identity (not just presence) also drops a slot some later `ensureSlot`
    // replaced under the same key.
    function selectSlots(selector: Partial<Args> | Args | undefined): Slot<Args, T>[] {
        const cache = slots()
        const own = ownSlotsIn(cache)
        const result: Slot<Args, T>[] = []
        // Compile the selector's canonical keys once, not per slot scanned.
        const compiled = selector === undefined ? undefined : compileSelector(selector)
        for (const [slotKey, slot] of own) {
            if (cache.get(slotKey) !== slot) {
                own.delete(slotKey) // evicted (or superseded) behind our back — self-heal
                continue
            }
            if (compiled === undefined || matchesSelector(slot.args, compiled)) result.push(slot)
        }
        return result
    }

    function isExpired(slot: Slot<Args, T>): boolean {
        // Checked before the ttl short-circuit: a deadline expires a slot regardless of retention policy.
        if (slot.expired) return true
        if (ttl === Infinity) return false
        const state = slot.state.untracked()
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

    // Writing a state that is observably identical to the current one must not wake anybody. The cell
    // short-circuits an equal SET, but every state here is a freshly built object, so identity always
    // differed and an idempotent refill — a `refresh` that produced the same value, a `publish` of the
    // value already held, a ttl re-fill of unchanged data — notified every reader anyway. Same reasoning
    // as `merged`; `value` is compared by identity for the same reason.
    //
    // Writing a state usually SETTLES the slot — a load finishing, a drop. So the refreshing flag clears
    // here by default, rather than each of the eight settle points having to remember to lower it.
    // `startLoad`'s keepStale branch raises it immediately after; `publish` opts out via `keepRefreshing`
    // because it is the one caller that is NOT a settle — a value arriving out of band does not end the
    // load that is still outstanding, and reporting `refreshing() === false` with a load in flight
    // contradicts rpc-core §7.3. Opting out LEAVES the flag rather than restoring it: clearing and
    // re-raising would wake the refreshing axis twice to report no net change, which is the exact
    // double-wake this split exists to remove.
    function setState(slot: Slot<Args, T>, next: SlotState<T>, keepRefreshing = false): void {
        if (!keepRefreshing) slot.refreshing.set(false)
        const current = slot.state.untracked()
        slot.state.set(sameSlotState(current, next) ? current : next)
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
        // A new run supersedes a deadline expiry (ADR 0028 D7) — the flag exists to force exactly this
        // run, so clearing it here is what keeps ONE cold retry from becoming a permanent one.
        slot.expired = false

        const current = slot.state.untracked()
        if (keepStale && current.status === 'value') {
            // The retained value is UNCHANGED, so `setState` writes nothing and no VALUE reader wakes.
            // Raising the flag AFTER it is what makes this the one exception to `setState`'s clear —
            // only the refreshing axis moves, so only what reads that axis is woken.
            setState(slot, {
                status: 'value',
                value: current.value,
                error: undefined,
            })
            slot.refreshing.set(true)
        } else {
            setState(slot, {
                status: 'pending',
                value: undefined,
                error: undefined,
            })
        }

        const generation = slot.generation
        const runLoad = (): Promise<T> =>
            (async () => {
                try {
                    // The run deadline covers PRODUCTION only (ADR 0028 D1). A streaming handler resolves
                    // here almost immediately — with the iterable, not the data — so its real clock is the
                    // per-chunk watchdog in `startStream`; bounding both from one timer would cut a healthy
                    // stream at T no matter how fast it was flowing.
                    const produced = (await withDeadline(
                        preProduced === undefined ? fn(slot.args) : preProduced.produced,
                        timeoutMs,
                    )) as T
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
                    setState(slot, { status: 'value', value, error: undefined })
                    recordAndEvict(slot, value)
                    return value
                } catch (caught) {
                    if (slot.generation === generation) {
                        slot.loadedAt = Date.now()
                        slot.expired = isTimeoutError(caught)
                        setState(slot, {
                            status: 'error',
                            value: undefined,
                            error: caught,
                        })
                    }
                    throw caught
                } finally {
                    if (slot.generation === generation) slot.inflight = null
                }
            })()

        // Fail-closed checkpoint (a), rpc-core §2: a crossRequest handler runs OUTSIDE the request scope, so
        // identity()/cookies()/request()/context() throw if it touches request scope → the read rejects
        // (error slot) and the value is never cached, in dev AND prod. A nested non-shared memo lands in
        // the neutral default scope. Non-shared memos keep running in the ambient scope.
        const promise = crossRequest ? exitScope(runLoad) : runLoad()

        slot.inflight = promise
        return promise
    }

    // On settle, record the value's JSON byte size and evict LRU entries over the ceiling — but only
    // for the two bounded server stores (shared + default scope). No-op when unbounded.
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
                    },
                }
            }
            // A promise or a decoded-chunk source is NOT a synchronous derivation — hand it back for the
            // classic path (§2: half-tracked is worse than untracked, so an async body is not tracked at all).
            const tagged = responseSourceOf(produced)
            if (tagged?.kind === 'stream') {
                warnUntracked('an async iterable')
                return { run: runs, deferred: produced }
            }
            if (isThenable(produced) || isStreamSource(produced)) {
                warnUntracked('a promise')
                return { run: runs, deferred: produced }
            }
            const value = (tagged?.kind === 'value' ? tagged.value : produced) as T
            return {
                run: runs,
                state: { status: 'value', value, error: undefined },
            }
        })
        const override = state<{ run: number; state: SlotState<T> } | null>(null)
        // An override survives only until the next fill. Reading `fill()` FIRST means a stale dependency is
        // recomputed (advancing `run`) before the stamps are compared, so a dependency change drops the
        // override in the same pull — "provisional until re-fill" (ADR 0024 §Context).
        // A derived value that re-computes to the SAME result must not wake its readers. `reactive.ts`
        // already cuts propagation on `oldValue !== value` — but `fill` builds a fresh envelope on every
        // run, so identity always differed and that cutoff never fired. The effect was that
        // `memo(() => count() > 5)` re-ran every downstream reader on every write to `count`, even
        // across writes that never flipped the boolean: the memoizer's cost with none of its benefit,
        // and measurably WORSE than reading the predicate inline at any real fan-out.
        //
        // Hand back the previous state object when nothing observable changed. This is applied to
        // `merged`'s OUTPUT rather than to `fill` on purpose: `fill`'s per-run `run` stamp is what
        // supersedes a stale `publish` override below, so it has to keep advancing.
        let previous: SlotState<T> | null = null
        const merged = computed<SlotState<T>>(() => {
            const base = fill()
            const next =
                'deferred' in base
                    ? idleState<T>()
                    : (() => {
                          const current = override()
                          return current !== null && current.run === base.run
                              ? current.state
                              : base.state
                      })()
            if (previous !== null && sameSlotState(previous, next)) return previous
            previous = next
            return next
        })
        // A PER-REQUEST slot's backing must not outlive the request: its `fill` subscribes to whatever the
        // body read, which is often a MODULE-level `state` that lives for the whole process. The slots of a
        // long-lived context (client singleton / server default) are long-lived too, so they register nothing.
        if (reactiveScope().requestScoped === true) {
            onScopeDispose(() => {
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
        const first = backing.fill.untracked()
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
        auto.version.set(auto.version.untracked() + 1)
        if (eager) auto.merged.untracked()
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
        // Drop it from the own-slot index too. `selectSlots` would self-heal this, but a long-lived
        // shared store churning stream slots should not accumulate dead index entries between verbs.
        ownSlotsIn(cache).delete(slot.key)
    }

    // Last consumer of a stream slot detached (ref-count hit 0). Dispose a settled ttl:0 slot; for a
    // still-open stream everyone abandoned, abort the source unless it is a retained (crossRequest, ttl>0) run
    // that should complete for a late joiner (§2 empty-refcount policy).
    function onStreamRefCountZero(slot: Slot<Args, T>, stream: ReplayableStream<unknown>): void {
        // A stale callback (the slot already re-ran into a NEW stream under the same key) must not touch it.
        if (slot.state.untracked().stream !== stream) return
        if (stream.settled) {
            // Dispose a ttl:0 slot, or an OVERFLOWED transcript (never retained for replay), on drain.
            if (ttl === 0 || stream.overflowed) disposeSlot(slot)
            return
        }
        if (!(crossRequest && ttl > 0)) {
            stream.abort()
            disposeSlot(slot)
        }
    }

    // Wrap a streaming source in a ReplayableStream on the slot and pump the source into it exactly once.
    // Concurrent/late reads fan out via `consume()` (a fresh cursor each); the source is never re-run.
    function bumpStreamTick(slot: Slot<Args, T>): void {
        const tick = slot.streamTick
        if (tick !== undefined) tick.set(tick.untracked() + 1)
    }

    // Incremental per-chunk accounting (replayable-streams.md §4): grow the slot's recorded size as the
    // transcript grows so an OPEN stream pressures the LRU live, and OVERFLOW past the per-stream cap so a
    // runaway can't grow unbounded. Only the two bounded server stores account; per-request/client don't.
    function accountStreamChunk(slot: Slot<Args, T>, stream: ReplayableStream<unknown>): void {
        if (slot.state.untracked().stream !== stream) return // stale (slot re-ran)
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
            stream,
        })
        // Chunks that are ALREADY KNOWN are pushed SYNCHRONOUSLY: a whole array (the mode-A handoff) or a
        // `StreamSeed`'s flushed prefix (mode B). Draining them through the loop below would append one per
        // microtask, leaving the transcript EMPTY for the rest of this tick — and attach-hydration reads it
        // synchronously to bind each painted item's value and claim the server's nodes, so an async fill
        // means it sees nothing and falls back to clearing the region. Nothing is awaited here.
        let tail: AsyncIterable<unknown> | Iterable<unknown> | undefined
        if (Array.isArray(source)) {
            for (const chunk of source) stream.push(chunk)
        } else if (isStreamSeed(source)) {
            for (const chunk of source.prefix) stream.push(chunk)
            tail = source.rest
        } else {
            tail = source
        }
        // A fully-known transcript settles NOW — there is no tail to await.
        if (tail === undefined) {
            stream.close()
            slot.loadedAt = Date.now()
            if (store !== undefined) {
                sharedCacheUnpin(store, slot.key)
                sharedCacheRecordSize(store, slot.key, stream.bytes)
                sharedCacheEvictIfNeeded(store)
            }
            bumpStreamTick(slot)
            return stream
        }
        const rest = tail
        void (async () => {
            // PROGRESS-based deadline (ADR 0028 D1): the clock measures time WITHOUT a chunk, so it is
            // armed before the first one and re-armed on every push — a stream that keeps flowing never
            // approaches it, however long it runs, which is exactly what lets SSR exempt an abide source
            // from the global `ABIDE_SSR_STREAM_BUDGET` (a total-wall-clock cut) and still be bounded.
            //
            // A refreshed timer rather than a raced `next()`: racing allocates a promise and a timer per
            // chunk on the hottest path a stream has, to observe an event that almost never fires.
            const watchdog = armStreamDeadline(timeoutMs, () => {
                // `fail`, not `abort`: an aborted ReplayableStream ends its consumers SILENTLY, and a
                // truncated list a caller cannot distinguish from a finished one is the failure mode D8
                // rejects. `fail` makes the cursor throw, which lands in the SSR streamer's existing catch
                // (`{:catch}` rendered, handle dropped, client re-runs) and reaches a browser
                // `{#for await}` as an ordinary iteration error.
                stream.fail(new DOMException('The rpc run exceeded its timeout.', 'TimeoutError'))
                // The stream's own `onAbort` no longer runs (it is settled), so stop the SOURCE directly.
                controller.abort()
            })
            try {
                for await (const chunk of rest) {
                    if (controller.signal.aborted) break
                    stream.push(chunk)
                    watchdog.progress()
                }
                stream.close()
            } catch (caught) {
                stream.fail(caught)
            } finally {
                watchdog.cancel()
                // Only touch the slot if it STILL holds this stream (not superseded by an invalidate/re-run).
                if (slot.state.untracked().stream === stream) {
                    // TTL-from-close (§2): the retention clock starts when the transcript settles, not at fn-resolve.
                    // A transcript the DEADLINE cut is settled-but-expired instead (ADR 0028 D7), so the next
                    // read re-runs rather than replaying a truncated one for the rest of its ttl.
                    slot.loadedAt = Date.now()
                    slot.expired = isTimeoutError(stream.error)
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
        // Point the cursor at the transcript behind it, so attach-hydration can bind each streamed item's
        // value SYNCHRONOUSLY and claim the server's nodes instead of clearing and re-painting them.
        tagStreamTranscript(cursor, stream.chunks)
        return cursor as unknown as T
    }

    // A stream slot resolves (inflight or settled) to the SHARED ReplayableStream; each caller must get its
    // OWN cursor. mapRead turns that shared stream into a fresh `consume()` per read; a scalar passes through.
    function mapRead(resolved: T): T {
        return resolved instanceof ReplayableStream ? streamCursor(resolved) : resolved
    }

    // The coalesced-load core: return the in-flight promise, the settled value/error/stream cursor, or
    // start a load. Non-reactive on its own (uses `state.peek()`); the bare call adds the subscription.
    // The KEYED SYNCHRONOUS read. Returns the value, or DEFERRED when this memo turns out to load — in
    // which case the already-produced promise is handed to `startLoad`, so `fn` is never run twice.
    //
    // Reading `slot.state()` FIRST (a tracked read, so the caller subscribes) is what makes a hydration
    // `seed`, a `publish`, and an `invalidate` authoritative: a settled slot is returned as-is and `fn`
    // stays uncalled. Only an idle or expired slot runs the body, and it runs UNTRACKED because the args
    // are the whole dependency set.
    function readKeyedSync(slot: Slot<Args, T>): T | typeof DEFERRED {
        const current = slot.state()
        // A STREAM slot is never this memo's business: it is a replayable transcript (including one warmed
        // by the SSR `seedStream` handoff, whose whole point is that the client does NOT re-invoke the
        // source). Hand it straight to the classic path, which returns a fresh cursor over it.
        if (current.status === 'stream') return DEFERRED
        const settled =
            !isExpired(slot) && (current.status === 'value' || current.status === 'error')
        if (settled) {
            // A settled slot only short-circuits once the body has been PROVEN synchronous. Until then it
            // must not: a slot can be settled without the body ever running (a hydration `seed`, a
            // `publish`), and returning its value here would hand a raw `T` back from an async memo whose
            // contract is `Promise<T>`. An idle slot falls through and the run below classifies it.
            if (keyedSync !== true) return DEFERRED
            if (current.status === 'value') return current.value as T
            throw current.error
        }
        // An in-flight load means a previous read already classified this memo as loading.
        if (slot.inflight !== null) return DEFERRED

        let produced: Promise<T> | T
        try {
            produced = untrack(() => fn(slot.args))
        } catch (caught) {
            keyedSync = true
            slot.loadedAt = Date.now()
            setState(slot, { status: 'error', value: undefined, error: caught })
            throw caught
        }
        const tagged = responseSourceOf(produced)
        if (tagged?.kind === 'stream' || isThenable(produced) || isStreamSource(produced)) {
            keyedSync = false
            void startLoad(slot, false, { produced }).catch(() => {
                // Retained on the slot and re-thrown to whoever awaits the read.
            })
            return DEFERRED
        }
        keyedSync = true
        const value = (tagged?.kind === 'value' ? tagged.value : produced) as T
        slot.loadedAt = Date.now()
        setState(slot, { status: 'value', value, error: undefined })
        return value
    }

    function coalescedLoad(slot: Slot<Args, T>): Promise<T> {
        const state = slot.state.untracked()
        // A settled/open stream slot hands back a fresh cursor over the shared buffer with no re-run — unless
        // it OVERFLOWED (not a valid replay target), in which case fall through to a fresh run.
        if (
            state.status === 'stream' &&
            state.stream !== undefined &&
            !state.stream.overflowed &&
            !isExpired(slot)
        ) {
            // Tag the promise with its synchronous value, exactly as the settled-VALUE path below does:
            // nothing is pending here (the buffer already exists), so a hydrating `{#for await}` can reach
            // the cursor — and through it the transcript — without awaiting a microtask it cannot await.
            const cursor = streamCursor(state.stream)
            return markSettled(Promise.resolve(cursor), cursor)
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
        if (keyedSyncEligible && keyedSync !== false) {
            const settled = readKeyedSync(slot)
            if (settled !== DEFERRED) return settled as T
        }
        slot.state()
        return untrack(() => coalescedLoad(slot))
    }) as Memo<Args, T>

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
        if (slot.state.untracked().status === 'stream') {
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
        const state = slot.state.untracked()
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
        return slot.refreshing()
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
        const state = slot.state.untracked()
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

    // The VALUE (or updater) is always LAST; the slot key is what precedes it — an argless memo passes
    // none (`publish(v)`), a keyed one passes its args (`publish({id}, v)`), and the explicit
    // `(undefined, v)` two-argument form unpacks identically.
    c.publish = ((
        ...published: [...Room<Args>, next: T | ((current: T | undefined) => T)]
    ): void => {
        const next = published[published.length - 1] as T | ((current: T | undefined) => T)
        const args = (published.length > 1 ? published[0] : undefined) as Args
        const slot = ensureSlot(args)
        resolveMode(slot)
        const auto = slot.auto
        if (auto !== undefined) {
            // The auto-tracked write (ADR 0024 §4): stamp the run being overridden, so the next re-fill of
            // any declared input drops it. `fill.peek()` pulls a stale fill first, so the updater form and
            // the stamp both see the CURRENT run.
            const base = auto.fill.untracked()
            const current = untrack(() => autoState(auto))
            const value =
                typeof next === 'function'
                    ? untrack(() => (next as (current: T | undefined) => T)(current.value))
                    : next
            auto.override.set({
                run: base.run,
                state: { status: 'value', value, error: undefined },
            })
            log.channel('abide:memo').trace(`publish ${id}`)
            broadcast('publish', args, value)
            return
        }
        const current = slot.state.untracked()
        let value: T
        if (typeof next === 'function') {
            // Updater-form. A closure can't cross the wire (rpc-core §2 tension): on a SHARED slot the
            // updater runs against the durable value here, then broadcasts its RESULT as a value-form
            // frame. A SERVER per-request (request-scoped) slot inside a request scope has nothing durable to
            // broadcast an updater against → error. On the client (or a bare/default-context server call
            // with no request scope), an updater-form publish stays a local mutation.
            if (!crossRequest && reactiveScope().requestScoped === true) {
                throw new Error(
                    'publish updater-form is not supported on a per-request memo; pass a value instead',
                )
            }
            value = untrack(() => (next as (current: T | undefined) => T)(current.value))
        } else {
            value = next
        }
        // A publish does not end an outstanding load, so it leaves the refreshing axis alone.
        setState(slot, { status: 'value', value, error: undefined }, true)
        log.channel('abide:memo').trace(`publish ${id}`)
        // Both forms broadcast the resolved VALUE (value-form frame) on a crossRequest slot.
        broadcast('publish', args, value)
    }) as Memo<Args, T>['publish']

    c.snapshot = (): Array<{ args: Args; value: T }> =>
        untrack(() => {
            const result: Array<{ args: Args; value: T }> = []
            for (const slot of selectSlots(undefined)) {
                const auto = slot.auto
                if (auto !== undefined) {
                    // Report an auto slot only once something has actually pulled it — reading it here would
                    // otherwise RUN `fn` for every cold derivation just to collect the seed.
                    if (!auto.filled()) continue
                    const state = auto.merged.untracked()
                    if (state.status === 'value')
                        result.push({ args: slot.args, value: state.value as T })
                    continue
                }
                const state = slot.state.untracked()
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
        setState(slot, { status: 'value', value, error: undefined })
    }

    // The WRITABLE PROJECTION (ADR 0024 §4). `set` IS `publish`, so a local write holds until the next
    // re-fill — the whole of the retired `state.linked`. Reading is `peek` semantics (reactive,
    // non-blocking); the blocking reads stay on the memo itself.
    // The key is a `Room` positional and the INITIAL is the trailing payload, unpacked exactly as
    // `publish`/`watch` do: `state(initial)` on an argless memo, `state({ id }, initial)` on a keyed one.
    // Both arities unpack identically, so the generic-safe two-argument form stays correct at runtime.
    //
    // Note what is NOT here any more: this used to read `c.peek(args) as T` twice, casting away the
    // `undefined` a cold slot really returns, and it synthesized the untracked read as
    // `untrack(() => c.peek(args))` — manufacturing one primitive's `peek` out of the other's, four lines
    // apart, which was the clearest possible evidence that the word meant two things (ADR 0027 D2).
    // With `untracked` named for what it does and an `initial` closing the cold hole, both lies are gone
    // and the projection is a real `State<T>`.
    c.state = ((...args: unknown[]): State<T> => {
        // Unpacking is keyed off `fn.length`, not off arity alone, because `state` is the one trailing-
        // payload verb whose payload is OPTIONAL (a sync memo needs no initial), which would otherwise
        // make `m.state(x)` ambiguous — room key, or initial? An ARGLESS memo has no room, so a lone
        // argument can only be the initial; a KEYED memo always names its room first, so the initial is
        // whatever follows it. `publish`/`watch` never hit this because their payload is mandatory.
        const keyed = fn.length > 0
        const slotArgs = (keyed ? args[0] : undefined) as Args
        const hasInitial = args.length > (keyed ? 1 : 0)
        const initial = hasInitial ? (args[args.length - 1] as T) : undefined

        // No retained value? With an initial (the ASYNC projection) that is the answer. Without one this
        // is a SYNC memo, whose bare call is T-or-throw — so defer to it, and an errored slot RETHROWS
        // here exactly as it would on a direct read. Reading `peek` alone would have moved the old
        // `as T` lie from "cold" to "errored" rather than removing it.
        const read = (): T => {
            const value = c.peek(slotArgs)
            if (value !== undefined) return value
            return hasInitial ? (initial as T) : (c(slotArgs) as T)
        }
        const cell = read as State<T>
        cell.set = (value: T) => c.publish(slotArgs, value)
        cell.untracked = () => untrack(read)
        return cell
    }) as Memo<Args, T>['state']

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

    // The HANDLER is last, the slot key precedes it — same unpacking as `publish`.
    c.watch = ((
        ...watched: [...Room<Args>, handler: (value: T | undefined) => void]
    ): (() => void) => {
        const handler = watched[watched.length - 1] as (value: T | undefined) => void
        const args = (watched.length > 1 ? watched[0] : undefined) as Args
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
    }) as Memo<Args, T>['watch']

    // Tag registry hooks (rpc-core §8, PR4). A crossRequest memo carrying tags registers these so the global
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
            if (slot.refreshing()) any = true
        }
        return any
    }

    if (crossRequest && tags.length > 0) {
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
