// A VALUE'S RECORD, AND THE ONE PLACE ITS SHAPE IS DECLARED. `Cell` and the sub-records it holds
// (`Cap`, `Persisted`, `Stream`, `Adoption`) live here rather than in `Reactive.ts` so a sibling
// that reaches a value's record — `Keyed`, `watch`, `byOf`, the selection index, the producer port —
// names the real type instead of re-declaring the few fields it reads.
//
// NO RUNTIME EDGE BACK TO THE CORE. `Reactive.ts` imports this, and a module reaching this ahead
// of the core would otherwise enter the cycle `index.ts` names. That is why `notify` — a cell's
// wake, which is a run of the graph — is put on the prototype by `Reactive.ts` (see `run` there)
// rather than declared as a method here: the instance shape is the constructor's, and a prototype
// slot is not part of it.

import type { Schema } from '../Schema.ts'
import { CELL } from './CELL.ts'
import { type Expiry, expiryFor } from './Expiry.ts'
import { MUTATION } from './MUTATION.ts'
import type { Identity, Reactive, ReactiveOptions, Store } from './Reactive.ts'
import { currentScope, type Scope } from './scoping.ts'
import { CLEAN, type Subscriber, type Tracked } from './tracking.ts'

/** The standing adoption: what is adopted, and the way to stop mirroring it. */
export type Adoption = { source: Cell; stop: () => void }

/**
 * The window a `throttle` or a `debounce` holds open, allocated only where one is declared.
 *
 * THE WINDOW A `throttle` OR A `debounce` HOLDS OPEN (RULEBOOK 5.8). One field on the
 * cell rather than one per window field, allocated only where a value declared one — the
 * shape `adoption` already uses, and for the same reason.
 *
 * WHAT A WINDOW CAPS IS THE WAKE, NEVER THE PRODUCTION (5.9). Every write still mints and
 * the ordinal moves. What waits is the value a READER sees and the cascade that tells it so,
 * which is the whole of 5.8's "how often a value changes for a reader".
 *
 * WHAT IT COSTS EVERY VALUE THAT NEVER CAPS: one field load and one branch on the write
 * path, plus `serve` as a frame rather than five stores inline. Measured at 0.99x -> 1.08x
 * against the hand-written arm on the since-removed `publish into a capped ring` case, consistent across three
 * runs over a 0.7% floor — about 1.3 ns on a 14.7 ns op. Moving the comparison target
 * behind the gate did not recover it, so it is the frame and the branch rather than a
 * wasted load. Inlining `serve` into the uncapped arm would buy it back for a second copy
 * of the reader-visible transition, and this file has already paid for one of those: the
 * trade is stated rather than taken, 1.3 ns being nowhere near perception.
 */
export type Cap = {
    /**
     * True for a throttle, which lets the leading change through; false for a debounce.
     *
     * 5.12 against 5.13, and the only difference between the two mechanisms: a throttle
     * lets the leading change through and holds what follows, a debounce holds everything
     * until the changes stop.
     */
    leading: boolean
    ms: number
    timer: ReturnType<typeof setTimeout> | null
    /**
     * The production the window is holding back, while `holding` is set.
     *
     * The production the window is holding back. `holding` is a field rather than a test
     * against `held`, because `undefined` is a value an app can write and so cannot carry
     * the absence.
     */
    held: unknown
    holding: boolean
    /**
     * The last production minted, which the identity gate compares against.
     *
     * WHAT THE IDENTITY GATE COMPARES AGAINST. On every uncapped value that is `cell.value`
     * and the two are one thing; a window moves the last production MINTED apart from the
     * last one RELEASED, and comparing against the released one would collapse a production
     * 5.9 forbids dropping — A, B, A inside one window is three productions, and only the
     * third's own predecessor makes it a repeat.
     */
    minted: unknown
    /**
     * Whether the window is holding back a body run.
     *
     * A BODY RUN THE WINDOW IS HOLDING BACK (5.11), against `holding`'s production. The two
     * are separate flags because they can stand together: a stream has a body AND tells its
     * chunks through the window (5.17), so one close can owe a run and a telling at once.
     */
    owed: boolean
    /**
     * Whether the window is holding back a refresh, started when it closes.
     *
     * 5.24 — A RELOAD THE WINDOW IS HOLDING BACK: a refresh made inside it, started when it closes.
     * Started there rather than owed like a run, because 7.11 reloads whether or not anything reads
     * and an owed run waits for a read to pull it.
     */
    reloading: boolean
}

/**
 * A value's store and the state of its writes, allocated only where a `store` was declared.
 *
 * A VALUE'S STORE AND WHAT ITS WRITES ARE DOING, allocated only where a `store` was declared.
 *
 * 8.10: ONE WRITE IN FLIGHT AND ONE PENDING. A production arriving while a write is out replaces
 * the pending value rather than queueing behind it: a slow store handed every intermediate is doing
 * work nobody can observe, and a queue is how it grows without bound behind a fast writer.
 */
export type Persisted = {
    store: Store<unknown>
    /** The value's own `ttl`, taken once, and infinity where it declares none (8.13). */
    ttl: number
    /**
     * Set while a production 8.8 does not write back is minted: a restore, which is what was just
     * read, and the initial value a miss falls back to, which the store never held.
     */
    withheld: boolean
    writing: boolean
    pending: boolean
    /**
     * The newest value handed to the store and not yet confirmed.
     *
     * THE NEWEST VALUE THE APP HAS HANDED THE STORE, standing until the store confirms it. It is
     * what `pending` sends next, and what 8.18 serves a re-read in place of calling `get`.
     */
    unconfirmed: unknown
    /** What stops the store's `watch`, where it has one (8.21). */
    unwatch: (() => void) | null
}

/**
 * A streaming producer's own state; `null` on every value whose body is not an async generator.
 *
 * A STREAMING PRODUCER'S OWN STATE (9.1, 9.2, 9.6), and `null` on every value whose body is
 * not an async generator — the shape `cap` and `adoption` already use.
 *
 * THE ACCUMULATION IS PUSHED INTO AND MATERIALIZED ON THE READ. A chunk is one push and one
 * cascade; the copy a reader is handed is taken by the read that follows, so a hundred
 * chunks between two reads are one copy rather than a hundred (9.2). The copy is FRESH per
 * chunk count and has to be: a reader holding an earlier snapshot still holds what it read,
 * and a value derived from this one compares by reference — the live buffer handed out would
 * be collapsed at every derived identity gate after the first chunk.
 *
 * WHAT THAT COSTS WHERE A READ FOLLOWS EVERY CHUNK is a copy of the accumulation per read,
 * and a reader woken per chunk made that a copy per chunk: twenty thousand chunks landing in
 * one task took 61 ms against 1.9 ms for the hand-written arm. 9.9 is what bounds it — the
 * wake is held to one per task, which is the unit a browser paints between, so the reads it
 * drops were never visible. A reader that reads per chunk on its own, unwoken, is still a
 * copy per read.
 */
export type Stream = {
    /**
     * The accumulation of the run being served — and the same array as `ring`, so a cursor
     * walks the chunks this holds rather than a second copy of them.
     */
    chunks: unknown[]
    /** The accumulation's version: moves on every release, patch and new run. */
    version: number
    /**
     * Which accumulation `value` stands for, as a `version` rather than a chunk count.
     *
     * A version rather than a chunk count because a patch changes the accumulation without
     * changing its length (9.13), and a write stands at the version it was made at until the
     * accumulation moves past it (9.11). -1 where nothing has been materialized.
     */
    materializedAt: number
    /**
     * Whether `value` is a write rather than a materialization.
     *
     * WHETHER `value` IS A WRITE rather than a materialization, while `materializedAt` stands. A value
     * forwarding this stream serves the write the way it would have served a production (11.59).
     */
    written: boolean
    /**
     * How many chunks a reader has been told of.
     *
     * HOW MANY CHUNKS A READER HAS BEEN TOLD OF. Every chunk as it lands, without a cap; with one,
     * only what the window has released (5.18) — the rest are in `chunks` for a cursor (5.10) and
     * out of what a read materializes until the release.
     */
    visible: number
    /** The run in flight, told to return when a newer run supersedes it. */
    iterator: AsyncIterator<unknown> | null
    /**
     * Which run is current; only a new run moves it.
     *
     * WHICH RUN IS CURRENT, and only a new run moves it. Apart from `generation`, which every
     * write moves so that a load it overtook lands nowhere — a write over a stream stands beside
     * the stream (9.11) rather than superseding it, and sharing the counter stopped the stream.
     */
    run: number
    /**
     * Whether a wake is already held for this task, so the next chunk only pushes.
     *
     * 9.9: chunks have landed that the readers have not been told about, and the value is
     * already in `WAKING` — so the next chunk in this task pushes and does nothing else.
     */
    waking: boolean
    /**
     * A probe moved under the held wake — the first chunk making the value ready, or one
     * clearing a standing error — and the wake owes it to the guards as well.
     */
    probesOwed: boolean
    /**
     * The stream this one forwards, and `null` on a value that produces its own.
     *
     * THE STREAM THIS ONE FORWARDS (11.15), and `null` on a value that produces its own. A
     * value adopting a stream IS that stream to a cursor, a guard and an await, so it holds
     * the adopted value's buffer and ring rather than copies — and this is what stops a
     * trigger on it starting its body as though the body were the generator.
     */
    source: Cell | null
    /**
     * How far the forwarding value's ordinals run ahead of the adopted value's, fixed when
     * the forwarding begins so the adopter's cursor positions go on from its own.
     */
    ordinalOffset: number
    /**
     * Whether what is served is a run that closed.
     *
     * WHETHER WHAT IS SERVED IS A RUN THAT CLOSED, which is the only accumulation a deadline
     * reaches (6.10). A run in flight has minted nothing, so `expiry.at` says nothing about it —
     * without this the standing arm reads `at` as 0 and drops the value on its first read.
     */
    closed: boolean
}

export function newStream(source: Cell | null): Stream {
    return {
        chunks: EMPTY_RING,
        version: 0,
        visible: 0,
        materializedAt: -1,
        written: false,
        iterator: null,
        run: 0,
        waking: false,
        probesOwed: false,
        source,
        ordinalOffset: 0,
        closed: false,
    }
}

/**
 * Every value that is not streaming shares this as its `ring`. The field stays monomorphically an
 * Array — CLAUDE.md's shape rule — and only a stream's own chunk buffer is ever pushed to. Frozen so
 * that if anything ever does push here, it says so rather than corrupting every other value at once.
 */
export const EMPTY_RING = Object.freeze([]) as unknown as unknown[]

/**
 * What an `invalidate` leaves behind: nothing owed, a look above, or a reload.
 *
 * WHAT AN INVALIDATE LEAVES BEHIND, and it is a debt rather than a mark. The mark walk's states
 * are the wrong tool: a node marked `CHECK` or `DIRTY` without its effects queued is one a later
 * write's walk stops at — `state >= wanted` — and the effects below it are never woken for a
 * change that really happened. So nothing in the graph's state moves; the invalidated value OWES
 * A RELOAD, the values built from it OWE A LOOK ABOVE, and none of them is directly servable, so
 * the read that reaches any of them goes a frame in and settles the debt first (7.12, 7.13).
 */
export const OWES_NOTHING: number = 0
export const OWES_ABOVE: number = 1
export const OWES_RELOAD: number = 2

/**
 * A value's internal state record, apart from the callable an app holds.
 *
 * THE INTERNAL FACE, AND A SECOND OBJECT. With the fields on the callable itself, every
 * one was a property added to a FUNCTION at construction, and that was most of what a
 * value cost to make: moving them here took `construct a value` from 123 ns to 87 under
 * JSC and from 101 to 83 under V8, and a derived value's construction, a chain and a
 * layered DAG 7-13% with it. Nothing measured moved the other way. The callable captures
 * its record, so a read is one context load — the hand-written arm's one captured
 * variable — and a member reaches the record through `CELL`, one load ahead of what it
 * did before.
 *
 * THE FIELD COUNT SITS ON A VM BOUNDARY AND IT IS NOT A LEVER. Both engines give an
 * object a fixed inline slot budget and spill the rest to an out-of-line store, and this
 * record is over it — so the count moves numbers that have nothing to do with the work.
 * Two independent measurements say the same thing from opposite ends. Taking `Cell` to
 * 38 is worth ~11% of `construct a value` and ~6-9% of the derived case, and it does not
 * matter HOW the four go: a consolidation into one record and four fields simply deleted
 * buy the same number, so the consolidation is not what pays. Going the other way,
 * 42 -> 46, is FREE — above the budget the out-of-line store already exists. And dropping
 * ONE field moved chain 20 and both layered DAGs +4.2% under V8 while moving nothing
 * under JSC; adding a DEAD boolean back put all three within 0.6%, which is the proof it
 * was layout and not work — that same dead boolean then cost the probe walk 6-7%.
 *
 * Above the budget is not free under JSC, though: three fields more (the dead-reader
 * counts and `probeCursor`) moved `construct a value` and the derived case +6-8% there,
 * and three UNUSED fields on the old record moved them the same — layout, not work.
 *
 * So the boundary is worth KNOWING and not worth engineering around. A field costs a few
 * ns of construction; getting under costs a structural change that the next field added here
 * silently undoes, and it re-rolls in a different direction for every row. If
 * construction ever needs that 11%, shed fields — do not build machinery to shed them.
 * And when a V8-only move of this size shows up on a graph row, the first thing to check
 * is whether the field count changed.
 */
export class Cell {
    /**
     * Who reads this value, on the value edge.
     *
     * ARRAYS, not sets. The mark walk walks this per write and a set's iterator
     * allocates. A disposed reader is left in place and counted rather than found — see
     * `dropFrom` in `tracking.ts` — so a walk over this skips `!alive`.
     */
    declare readers: Subscriber[]
    declare deadReaders: number
    /**
     * Who asked about this value's PROBES — a different edge from `readers`, and see
     * `markProbes` for what that buys.
     */
    declare probeReaders: Subscriber[]
    declare deadProbeReaders: number
    declare sources: Cell[]
    /**
     * The values whose PROBES this body asked about — a `Cell` is a `Subscriber`, so it
     * carries the reader half of the probe edge as well as the source half.
     */
    declare probeSources: Cell[]
    declare probeCursor: number
    declare cursor: number
    /** See `Subscriber.seen`. */
    declare seen: Set<Cell> | null
    declare seenThrough: number
    declare scanningFrom: number
    declare label: string
    declare body: ((args: unknown) => unknown) | null
    declare args: unknown
    declare value: unknown
    declare landed: boolean
    /**
     * Whether a read may answer with `value`.
     *
     * WHETHER A READ MAY ANSWER WITH `value`. Implies `landed`, and is false over a landed value
     * a trigger, an abort or an adoption has stopped serving — which is the state `landed`
     * alone cannot say.
     */
    declare servable: boolean
    /**
     * Whether a read can return `value` straight, without going a frame in.
     *
     * `state === CLEAN && servable` — the whole of "this read can return the field",
     * maintained rather than recomputed. A read is the hottest path in the design and it
     * was three loads and three branches to decide.
     *
     * THE INVARIANT IS ONE-DIRECTIONAL and that is what makes it safe to maintain by
     * hand: `true` is written only where all three are known to hold, and every
     * transition that can break one of them writes `false`. So a site that forgets to
     * set it true costs a frame on the reads that follow and cannot serve a wrong value,
     * which is the opposite of how a maintained flag usually fails.
     */
    declare direct: boolean
    declare loading: boolean
    declare failure: unknown
    /**
     * The compiled `identity` comparator.
     *
     * `null` IS the default — see `comparatorFor`.
     */
    declare identityFn: ((next: unknown, previous: unknown) => boolean) | null
    /**
     * The comparator this value DECLARED, which `identityFn` returns to when an adoption ends.
     *
     * 11.17 inherits the adopted value's `identity` only where the outer declared none, and only
     * for as long as it adopts: kept on `identityFn` alone, the inherited comparator outlived the
     * adoption and gated the outer's own productions — `flag() ? inner : count()` with `inner`
     * keyed on `.id` read every number as the same `undefined` and never woke again.
     */
    declare declaredIdentityFn:
        ((next: unknown, previous: unknown) => boolean) | null
    declare transform: ((value: unknown) => unknown) | null
    /**
     * `null` on every value that declares no `schema`, which keeps the gate off the write
     * path of everything that did not ask for one.
     */
    declare schema: Schema<unknown> | null
    /**
     * A streaming producer's chunk buffer, for a cursor to walk (2.6); `EMPTY_RING` on every
     * other value.
     */
    declare ring: unknown[]
    /**
     * The ordinal before `ring[0]`, so `ring[index]` carries ordinal `ringBase + index + 1` and a
     * cursor finds its place from the ordinal it holds.
     */
    declare ringBase: number
    /**
     * `null` on every value that declares no `ttl`, and on every value 6.2 makes it inert
     * for. Its presence is also what holds `direct` false — see `serve`.
     */
    declare expiry: Expiry | null
    declare ordinal: number
    declare generation: number
    declare alive: boolean
    declare isEffect: boolean
    declare isMirror: boolean
    declare adopter: Tracked | null
    declare enclosing: Subscriber | null
    declare opens: boolean
    /**
     * The mark: `CLEAN`, `CHECK` or `DIRTY`.
     *
     * `CLEAN`, `CHECK` or `DIRTY` — see `tracking.ts`. Stamped on every transitive
     * reader BEFORE anything runs, so a body that reaches a source which has not caught
     * up yet pulls it forward; `running` is what stops a body already on the stack being
     * re-entered.
     *
     * ONE RUN PER NODE PER WRITE is the contract, and the state carries it without a
     * cascade counter: a node that has run is `CLEAN`, and only a source PRODUCING can
     * mark it again — which a source it already read cannot do, because reading it is
     * what resolved it.
     */
    declare state: number
    declare running: boolean
    /**
     * Whether the last run aborted on a value that had not landed.
     *
     * 2.13: A RUN THAT ABORTED ON A VALUE THAT HAD NOT LANDED, and is owed the rest of itself
     * when that value arrives. Push-pull leaves a marked body for the read that wants it, and
     * that is right for a body which RAN — this one did not, so nothing downstream can pull it:
     * a reader guarding on `ready()` asks the probe edge and never the value, and the guard would
     * answer false for as long as nobody read through it.
     */
    declare aborted: boolean
    /**
     * The value this one adopted, or `null`.
     *
     * WHAT THIS VALUE'S BODY HANDED BACK, where it handed back another `Reactive`
     * (11.12). `null` on every value that is not adopting, which is nearly all of them —
     * one field rather than two, and the record is allocated only where there is one.
     */
    declare adoption: Adoption | null
    /**
     * `null` on every value declaring neither `throttle` nor `debounce`, which is nearly
     * all of them.
     */
    declare cap: Cap | null
    /**
     * `null` on every value declaring no `tags`, which keeps `markProbes` from looking up a
     * selection signal for any of them.
     */
    declare tags: string[] | null
    /** Whether `declare` built this value for a mutation, which a sweep invalidates (13.16). */
    declare mutation: boolean
    /**
     * Whether what is held was written here since the producer last produced (3.10).
     *
     * Only ever true on a value with a body: a value with no producer has nothing to be out of
     * step with (3.12). Moved by `writtenHere` and `producedAgain` alone, each owning its probe move.
     */
    declare local: boolean
    /** `null` on every value declaring no `store`, which is what keeps `serve` from persisting. */
    declare store: Persisted | null
    /**
     * The declared `by`.
     *
     * 5.22 — held as declared rather than as a function, so the property name is still there to send.
     */
    declare by: string | ((element: unknown) => unknown) | null
    /** The probe pass this cell was last visited in. See `walkBusy` and `walkReady`. */
    declare probePass: number
    /**
     * `OWES_NOTHING`, `OWES_ABOVE` or `OWES_RELOAD` — what an `invalidate` left for the next read
     * to do. See `invalidateOne`.
     */
    declare owes: number
    /** The value this record is the state of — what `NotLanded` names as its source. */
    declare callable: Reactive<unknown> | null
    /** `null` on every value whose body is not an async generator, which is nearly all. */
    declare stream: Stream | null
    /**
     * Whether a read may ever take the field straight, fixed at construction.
     *
     * WHETHER A READ MAY EVER TAKE THE FIELD STRAIGHT, fixed at construction: no expiry to
     * check and no accumulation to materialize. `setDirect` reads this one field where it
     * would otherwise read one per mechanism that needs the read to go a frame in.
     */
    declare plain: boolean
    /**
     * Whether a settled write goes straight to `produce`, past no gate.
     *
     * NOTHING STANDS BETWEEN A SETTLED WRITE AND `produce`: no `schema`, no `transform`, and no
     * stream whose writes stand apart from its chunks (9.11, 9.12). One field where the write and
     * the recompute each tested two, maintained where a forwarded stream comes and goes.
     */
    declare bareWrite: boolean
    /**
     * Whether a gated write can take `SIMPLE_PROTOTYPE`'s short path.
     *
     * EVERYTHING A GATED WRITE WOULD OTHERWISE ASK, IN ONE FIELD: no cap holding the
     * production back, no expiry, no store to persist through, no
     * declared `identity`, and `bareWrite`'s own three. A value carrying none of them has a
     * `produce` -> `serve` -> `cascade` that reduces to three stores and a mark — which is
     * what `SIMPLE_PROTOTYPE.set` spells out rather than calls.
     *
     * IT SELECTS A PROTOTYPE AND IS NOT READ ON THE WRITE PATH. See `SIMPLE_PROTOTYPE`.
     *
     * MAINTAINED, NOT FIXED: three of the fields under it move after construction —
     * `bareWrite` and `plain` where a forwarded stream comes and goes, `identityFn` where an
     * adoption takes the inner value's. `simpleShape` is called at each of those.
     */
    declare simple: boolean
    /**
     * The scope this value was built in, and so the one its body runs under.
     *
     * 11.32 — THE SCOPE THIS VALUE WAS BUILT IN, and so the one its body runs under. `undefined` in a
     * browser, and on a server for a value built outside any request.
     */
    declare scope: Scope | undefined
    /**
     * Whether this value is one for the whole process, in every scope.
     *
     * 11.34, 13.13 — one value for the process, and so inside every scope a selection is made in. An
     * entry of a `global` keyed value is one too, whichever request first reached it.
     */
    declare global: boolean
    /**
     * The one weak handle every selection index holds this value by, or `null` where none does.
     *
     * 13.1 AND 13.6: a value filed for the bare sweep or carrying `tags` is findable by one, and
     * every index holds the same handle, so an eviction drops it from all of them at once.
     */
    declare ref: WeakRef<Cell> | null
    /**
     * Whether this value is filed for the bare selection — once, where it first becomes a load.
     *
     * See `fileProducer`. Not cleared by an eviction: dropping `ref` is what takes an evicted entry
     * out, and this staying set is what keeps its next load from filing it again.
     */
    declare filed: boolean
    /**
     * Whether what this value was built in has stopped — the setup or the request that owned it.
     *
     * 12.14. Set by `orphan`; the value lets go of its sources once nothing
     * reads it (`releaseOrphan`), which may be at once or when the last reader outside its owner leaves.
     */
    declare orphaned: boolean
    /** A cell's wake, which is a run of the graph: on the prototype, from `Reactive.ts` — see above. */
    declare notify: () => void

    constructor(
        label: string,
        body: ((args: unknown) => unknown) | null,
        args: unknown,
        options: ReactiveOptions<unknown, unknown, never> | undefined,
        streaming: boolean,
    ) {
        // Every field, in one order, `undefined` included.
        this.readers = []
        this.deadReaders = 0
        this.probeReaders = []
        this.deadProbeReaders = 0
        this.sources = []
        this.probeSources = []
        this.probeCursor = 0
        this.cursor = 0
        this.seen = null
        this.seenThrough = 0
        this.scanningFrom = -1
        this.label = label
        this.body = body
        this.args = args
        this.value = undefined
        this.landed = false
        this.servable = false
        this.direct = false
        this.loading = false
        this.failure = undefined
        this.identityFn = comparatorFor(
            options?.identity as Identity<unknown> | undefined,
        )
        this.declaredIdentityFn = this.identityFn
        this.transform = (options?.transform ?? null) as
            ((value: unknown) => unknown) | null
        this.schema = (options?.schema ?? null) as Schema<unknown> | null
        this.ring = EMPTY_RING
        this.ringBase = 0
        // 6.2 DECIDED ONCE, here rather than per production: a body is what makes a value a
        // producer, and a plain state is the one this must not reach. See `expiryFor`.
        this.expiry = expiryFor(
            options?.ttl,
            // A store is a producer too (8.2): there is somewhere to get the value back from, so
            // `ttl` on a value holding one drops rather than being inert.
            body !== null || options?.store !== undefined,
        )
        this.ordinal = 0
        this.generation = 0
        this.alive = true
        this.state = CLEAN
        this.running = false
        this.aborted = false
        this.adoption = null
        this.cap = capFor(label, options?.throttle, options?.debounce)
        const tags = options?.tags
        this.tags =
            tags === undefined
                ? null
                : typeof tags === 'function'
                  ? tags(args as never)
                  : tags
        this.mutation =
            (options as { [MUTATION]?: true } | undefined)?.[MUTATION] === true
        this.local = false
        const store = options?.store
        this.store =
            store === undefined
                ? null
                : {
                      store: (typeof store === 'function'
                          ? store(args as never)
                          : store) as Store<unknown>,
                      ttl: options?.ttl ?? Number.POSITIVE_INFINITY,
                      withheld: false,
                      writing: false,
                      pending: false,
                      unconfirmed: undefined,
                      unwatch: null,
                  }
        this.by = (options?.by ?? null) as
            string | ((element: unknown) => unknown) | null
        this.probePass = 0
        this.owes = OWES_NOTHING
        this.isEffect = false
        this.isMirror = false
        this.adopter = null
        this.enclosing = null
        this.opens = false
        this.callable = null
        this.stream = streaming ? newStream(null) : null
        this.plain = this.expiry === null && this.stream === null
        this.bareWrite =
            this.schema === null && this.transform === null && !streaming
        this.simple = false
        this.scope = currentScope()
        this.global = options?.global === true
        this.ref = null
        this.filed = false
        this.orphaned = false
        simpleShape(this)
    }
}

/** What a member's `this` is, and the one way from the value an app holds to its record. */
export type Callable = { [CELL]: Cell }

/**
 * Throws where a value declares both `throttle` and `debounce`.
 *
 * 5.14 is a BUILD error and there is no build yet, so it lands at construction — the
 * earliest moment that exists, and the one the app still has a stack for. Naming the value
 * is the clause's own requirement; without it a page declaring both on one of forty values
 * says only that something did. One statement for both producers of a window: a value's
 * (5.8) and a keyed value's, which caps starts rather than wakes (5.19).
 */
export function refuseBothCaps(
    label: string,
    throttle: number | undefined,
    debounce: number | undefined,
): void {
    if (throttle !== undefined && debounce !== undefined)
        throw new Error(
            `${label} declares both throttle and debounce. A value is capped one way or the other.`,
        )
}

export function capFor(
    label: string,
    throttle: number | undefined,
    debounce: number | undefined,
): Cap | null {
    refuseBothCaps(label, throttle, debounce)
    const ms = throttle ?? debounce
    if (ms === undefined) return null
    return {
        leading: throttle !== undefined,
        ms,
        timer: null,
        held: undefined,
        holding: false,
        minted: undefined,
        owed: false,
        reloading: false,
    }
}

/**
 * Compiles `identity` into a comparator, or `null` for the default `Object.is`.
 *
 * THE DEFAULT IS THE REFERENCE, and `structural` is exported for an app to pass.
 *
 * THE CASE FOR A STRUCTURAL DEFAULT IS REAL: a reload that fetched an equal
 * payload builds a FRESH object, so a reference compare never fires and every reader
 * wakes on a value that did not change. What decides it against that is the cost on
 * the shape an app actually holds — a compare walks the whole value on EVERY write,
 * where the wake it avoids is paid only when the payload really is equal. A grid of
 * rows re-assembled per recompute pays the deep walk every time and collapses never.
 *
 * So the framework takes the cheap, predictable default — `===` is what JavaScript
 * means by "the same value" — and the app names `identity: structural` on the values
 * where re-materialization is the common case. 5.5's "not equal wherever it cannot
 * decide" is unchanged; it is just no longer the default reading.
 *
 * `identity` is discriminated by ARITY (5.3), once, at construction — not per compare.
 *
 * NULL IS THE DEFAULT, not a function that implements it. `produce` compares against
 * `null` and calls `Object.is` directly, which takes an INDIRECT call off the write path:
 * the site is polymorphic across the default, a projection closure and whatever an app
 * passed, so it is not one an engine can speculate through. The saving is the indirection
 * rather than the comparison — `Object.is` is itself the fastest spelling of it.
 */
export function comparatorFor(
    identity: Identity<unknown> | undefined,
): ((next: unknown, previous: unknown) => boolean) | null {
    if (identity === undefined) return null
    if (identity.length >= 2)
        return identity as (next: unknown, previous: unknown) => boolean
    const project = identity as (value: unknown) => unknown
    return (next, previous) => project(next) === project(previous)
}

/**
 * Recomputes `simple` and re-seats the callable on the matching prototype.
 *
 * `simple` IN ONE PLACE. A second copy of this conjunction is the drift that would let one of the
 * sites go on reading `true` after the field under it moved — and what the short write would then
 * skip is a cap, a ring or a declared `identity`, silently. The prototype that goes with it is
 * `seat`'s, taken where the transition that moved a field under it ends.
 */
export function simpleShape(cell: Cell): void {
    cell.simple =
        cell.bareWrite &&
        // `plain` carries `expiry === null` and `stream === null` already.
        cell.plain &&
        cell.cap === null &&
        cell.store === null &&
        cell.identityFn === null
}

/**
 * The record `value` keeps its state on, for a reader outside the core: `value` is a `Reactive`, and
 * this is the one cast from what an app holds to the record, rather than one per reader.
 */
export function cellOf(value: unknown): Cell {
    return (value as Callable)[CELL]
}
