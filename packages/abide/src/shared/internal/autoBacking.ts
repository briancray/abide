// THE AUTO-TRACKED DERIVATION BACKING (ADR 0024 §1-3) — one of `memo`'s three FILL MODES, as a module.
//
// `CONTEXT.md` ("Fill mode") names the three ways a slot fills and says the dichotomy needs one
// statement per question rather than one per caller. The per-slot VERBS were extracted on that
// reasoning; this is the state machine they ask about, and it had everything a module has except a
// file — a declared interface (`AutoBacking`, 7 members), a constructor, and coupling to the enclosing
// closure narrow enough to name (the eight fields of `AutoBackingContext` below).
//
// It is also a seam the TESTS need and no CALLER crosses. Nothing outside `memo.ts` ever touched
// `AutoBacking`, yet roughly half of `memo.test.ts` drove it through the whole memo surface — including
// eleven cases that sleep real milliseconds because the gate's timing was only reachable through a
// constructed memo. One layer down, `refetchClock.ts` had already had to export `refetchClockDecision`
// as "an internal seam, for the tests only" for exactly that reason.
//
// The three defects recorded in here are all INTERNAL to this seam and none is reachable from a caller:
// `cancelClock`'s two carriers, the `merged`-identity propagation cutoff, and the `currentRun` stamp.

import { isStreamSource } from './isStreamSource.ts'
import { isThenable } from './isThenable.ts'
import { type Computed, computed, type State, state } from './reactive.ts'
import { onScopeDispose, reactiveScope } from './reactiveScope.ts'
import { type RefetchWindow, refetchWindow } from './refetchClock.ts'
import { responseSourceOf } from './responseSource.ts'
import { idleState, type SlotState, sameSlotState } from './slotState.ts'

// WHAT THE BACKING NEEDS FROM THE MEMO AROUND IT. Eight fields, which is the measure of how narrow
// this seam always was — a body to run, the fail-closed wrapper to run it inside, the two clock
// numbers, three facts about who owns the slot's lifetime, and one diagnostic that belongs to the memo.
export interface AutoBackingContext<T> {
    // The memo body, already bound to this slot's args.
    body: () => Promise<T> | T
    // The single statement of fail-closed checkpoint (a): a `crossRequest` body runs scope-exited on
    // every path, so it cannot bake one caller's identity into a shared value. Passed in rather than
    // reimplemented, because it is `memo.ts`'s rule and there is one of it.
    runFillBody: <R>(call: () => R, untracked: boolean) => R
    // The SWR refetch clock. `0` = no gate. `isDebounce` picks the edge.
    clockMs: number
    clockIsDebounce: boolean
    // A `crossRequest` slot is long-lived even though it is BUILT inside a request, so it opts out of
    // the request-scoped teardown below.
    crossRequest: boolean
    // The scope the MEMO was declared in, captured at construction — deliberately NOT whatever effect
    // scope happens to be open at this slot's first read.
    ownerDisposal: { register: (dispose: () => void) => void } | undefined
    // Drop this slot from its store. Both halves of the leak need it: the computed nodes hold an
    // observer edge in whatever the body read, and the SLOT holds an entry in the tab-global map.
    disposeSlot: () => void
    // The ADR 0027 D8 diagnostic, fired when the first run proves the body async — i.e. when adding one
    // `await` silently turned a tracked derivation into a manually-invalidated cache. INJECTED because
    // it closes over the memo's id and its `loader` flag, both of which are the memo's, not this
    // backing's; what belongs here is only the moment it is known.
    warnUntracked: (produced: string) => void
}

// One run of an AUTO-TRACKED fill. `run` counts fills of this slot. `deferred` carries the produced value
// when the run turned out to be async/streaming after all — only the produced value can tell (ADR 0024
// §2), so the classifier hands it straight to the classic coalesced path rather than re-invoking `fn`.
export type AutoFill<T> = { run: number; state: SlotState<T> } | { run: number; deferred: unknown }

// The AUTO-TRACKED backing of one slot (ADR 0024 §1-3). `fn`'s synchronous reads ARE this memo's declared
// inputs, so it runs inside a `computed` whose dependency set is re-collected on every run. Pull-based, so
// a read that follows a dependency write in the same tick already sees the fresh value — no microtask lag.
//
// A `publish` stamps the `run` it overrode, and `merged` honours an override only while that stamp is
// still current. A dependency change re-runs `fn`, advancing `run`, which drops the override. That single
// rule is the whole of the retired `state.linked`: provisional until re-fill (ADR 0024 §Context).
export interface AutoBacking<T> {
    // Bumped by invalidate/refresh to force a re-run even when no dependency changed.
    version: State<number>
    fill: Computed<AutoFill<T>>
    override: State<{ run: number; state: SlotState<T> } | null>
    merged: Computed<SlotState<T>>
    // Whether a fill has run, so `snapshot()` reports a filled slot without forcing a cold one to run.
    filled: () => boolean
    // The run `merged` is currently SERVING. Equal to `fill`'s latest except while a refetch clock is
    // holding a newer fill back, which is exactly when a `publish` override must not stamp the live one.
    currentRun: () => number
    // This backing's refetch window, or undefined when no clock is configured. Exposed rather than
    // closed over, because a slot's two windows must be reachable from the same two places: `cancelClock`
    // (an `invalidate` used to leave a scheduled auto publication armed, because it could only see the
    // pulled one) and `refreshing()` (which reported a constant `false` here for the same reason).
    gate: RefetchWindow | undefined
}

// The refetch clock on a DERIVATION: one gated auto backing's publication window. `admitted` is the
// fill `merged` serves; `null` until the first pull, which publishes immediately (a derivation with
// nothing yet to show is the auto-path twin of a cold load). The TIMING is the shared `RefetchWindow`;
// what stays here is the state the pulled path has no equivalent of — a call gates and holds nothing,
// a publication gates and holds the value being withheld.
interface AutoGate<T> {
    tick: State<number>
    admitted: AutoFill<T> | null
    source: Computed<AutoFill<T>> | undefined
    window: RefetchWindow
}

// ---- The same clock, on the AUTO-TRACKED (derivation) path -----------------------------------
// Gates what the derivation PUBLISHES. It cannot gate how often the body RUNS: a derivation's
// dependency set is only knowable by running it, so learning that an input moved means running it.
// For the case this exists for that is the right split — `memo(() => q(), { debounce: 300 })` is
// trivial to run, and the expensive work downstream sees only admitted values.

function createAutoGate<T>(clockMs: number, clockIsDebounce: boolean): AutoGate<T> {
    const gate: AutoGate<T> = {
        tick: state(0),
        admitted: null,
        source: undefined,
        window: undefined as unknown as RefetchWindow,
    }
    gate.window = refetchWindow({
        isDebounce: clockIsDebounce,
        ms: clockMs,
        fire: (deferred) => {
            const source = gate.source
            if (source === undefined) return
            // Read the fill at FIRE time, not at arm time: several changes may land inside one
            // window and the NEWEST is what should be published. `untracked()` recomputes a dirty
            // computed, so this is genuinely the latest — and `merged`'s next `fill()` returns that
            // same cached object, so the identity compare there sees no move and the gate does not
            // re-arm.
            gate.admitted = source.peek()
            // A LEADING-edge admission happens inside `merged`'s own run, so it is a plain field
            // write into the computation that is about to return that very value — bumping the tick
            // there would be a state write during a computation, and there is nobody to wake who is
            // not already awake. A trailing one fires from a timer and must wake `merged` itself.
            if (deferred) gate.tick.set(gate.tick.peek() + 1)
        },
    })
    return gate
}

// ---- AUTO-TRACKED fill (ADR 0024 §1-3) -------------------------------------------------------
// The second fill path for the same slot. `fn` runs inside a `computed`, so every state it reads
// synchronously becomes a declared input of this memo and a change to one is an ordinary re-fill.
// Pull-based and lazy: nothing runs until something reads, and a read that follows a dependency write
// in the same tick already sees the fresh value.

export function createAutoBacking<T>(context: AutoBackingContext<T>): AutoBacking<T> {
    const version = state(0)
    let runs = 0
    let ranOnce = false
    const fill = computed<AutoFill<T>>(() => {
        version() // subscribe: invalidate/refresh force a re-run with no dependency change
        runs++
        ranOnce = true
        let produced: Promise<T> | T
        try {
            // Fail-closed checkpoint (a) — see `runFillBody`. TRACKED, because reading this body is
            // how the memo learns its inputs.
            produced = context.runFillBody(context.body, false)
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
            context.warnUntracked('an async iterable')
            return { run: runs, deferred: produced }
        }
        if (isThenable(produced) || isStreamSource(produced)) {
            context.warnUntracked('a promise')
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
    // The refetch clock on a DERIVATION (rpc-core §3). It gates what the derivation PUBLISHES, not
    // how often its body runs: learning that a dependency moved means running the body, since a
    // derivation's dependency set is only knowable by running it. That is the right split for the
    // case this exists for — `memo(() => q(), { debounce: 300 })` feeding `getQuery({ q: slow() })`
    // — where the derivation is trivial and the EXPENSIVE thing is downstream, seeing only admitted
    // values.
    //
    // Pull-based, deliberately. Scheduling from an `effect` would have been simpler to read, but
    // `effect()` hands its disposer to the innermost open effect scope — so a module-level memo
    // first read inside a component's `<script>` would have its clock torn down when that component
    // unmounted, killing the gate for every other reader. `merged` already re-runs on a dependency
    // change (it subscribes to `fill`), so the arming rides that pull and no detached-effect escape
    // hatch is needed.
    const gate =
        context.clockMs === 0
            ? undefined
            : createAutoGate<T>(context.clockMs, context.clockIsDebounce)
    let previous: SlotState<T> | null = null
    const merged = computed<SlotState<T>>(() => {
        const live = fill()
        let base = live
        if (gate !== undefined) {
            gate.tick() // subscribe: an admission wakes this computed
            if (gate.admitted === null) {
                // The FIRST fill publishes immediately — the same rule as a cold load on the loading
                // path. There is nothing to serve while it waits, so delaying it only blanks the read.
                gate.admitted = live
            } else if (live !== gate.admitted) {
                // A dependency (or a refresh/invalidate bumping `version`) moved the fill past what
                // is published. Throttle's LEADING EDGE publishes it right here; otherwise the
                // window arms and the admitted value keeps being served until it fires.
                gate.window.trigger()
            }
            base = gate.admitted
        }
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
    // `publish` must stamp the run `merged` is actually serving, not the one `fill` has reached — on
    // a gated backing those differ for the length of a window, and stamping the live run would make
    // every override inside one land already-superseded.
    const currentRun = (): number => {
        if (gate?.admitted != null) return gate.admitted.run
        return fill.peek().run
    }
    if (gate !== undefined) gate.source = fill
    // A PER-REQUEST slot's backing must not outlive the request: its `fill` subscribes to whatever the
    // body read, which is often a MODULE-level `state` that lives for the whole process. The slots of a
    // long-lived context (client singleton / server default) are long-lived too, so they register nothing.
    //
    // A `crossRequest` slot is long-lived in the same way even though it is BUILT inside a request: it
    // lives in `sharedStore()`, so disposing its backing at request end would leave the next request
    // holding a slot whose `auto` is a dead computed that can never re-fill.
    if (reactiveScope().requestScoped === true && !context.crossRequest) {
        onScopeDispose(() => {
            // The gate's timer closes over `fill`, so it has to go first or a pending admission
            // would fire into a disposed computed at the end of the request.
            gate?.window.cancel()
            merged.dispose()
            fill.dispose()
        })
    }
    // `requestScoped` is structurally false in a BROWSER, so the branch above covered the server and
    // nothing else — and a `memo(() => moduleState() * 2)` declared in a component `<script>` left
    // its `fill` computed in `moduleState`'s observer list, and its slot in the tab-global scope, on
    // every mount. Unbounded growth, plus O(mounts) work on every write to that module state.
    //
    // The owner is the scope the MEMO was declared in, captured at construction (`ownerDisposal`) —
    // deliberately NOT whatever effect scope happens to be open at this slot's first read. Slots are
    // created lazily, so a module-level memo's first read can land inside any component, and hanging
    // its teardown there would tear down a shared memo when that one component unmounted. Same rule
    // the tag registration uses, and the same reason.
    //
    // BOTH halves go, because the leak has two: the computed nodes hold an observer edge in whatever
    // the body read (so every write to a module `state` walks one dead observer per past mount), and
    // the SLOT holds an entry in the tab-global map (so the map grows without bound). Disposing the
    // backing alone would have fixed the work and left the memory.
    context.ownerDisposal?.register(() => {
        gate?.window.cancel()
        merged.dispose()
        fill.dispose()
        context.disposeSlot()
    })
    return {
        version,
        fill,
        override,
        merged,
        filled: () => ranOnce,
        currentRun,
        gate: gate?.window,
    }
}
