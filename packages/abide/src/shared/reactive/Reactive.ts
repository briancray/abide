// THE REACTIVE VALUE. RULEBOOK 1.1: every producer in this design hands back one of
// these, and after the collapse there is exactly one other result type beside it.
//
// The value is a FUNCTION capturing one record, `Cell`, that carries its state, and
// REACHING its members through one shared prototype. CLAUDE.md, hot paths: prefer a class
// or a plain record to a closure that captures its enclosing scope. A per-instance closure
// set would be fourteen allocations and fourteen captured scopes per value, and a page
// holds one per row — and copying the shared ones onto each instance instead was 87% of
// what a value cost to construct. See `MEMBER_PROTOTYPE`.
//
// Every field `Cell` declares is written in its constructor, in one order, `undefined`
// included — a shape that grows a field on a later path is two hidden classes and every
// read downstream of it deoptimises.

import { type Failed, isFailed, isFailedNamed } from '../Failed.ts'
import { namedLogger } from '../log.ts'
import { validationError } from '../refuse.ts'
import { type Found, runSchema, type Schema } from '../Schema.ts'
import { WORK } from '../WORK.ts'
import { CELL } from './CELL.ts'
import { ENTRY_LIVES } from './ENTRY_LIVES.ts'
import {
    armTimer,
    dropExpired,
    type Expiry,
    expiryFor,
    headDeadline,
    type Ringed,
} from './Expiry.ts'
import { FOLLOWED } from './FOLLOWED.ts'
import {
    type History,
    historyFrom,
    type Retained,
    retained,
} from './History.ts'
import { isReactive } from './isReactive.ts'
import { isThenable } from './isThenable.ts'
import { NO_INITIAL } from './NO_INITIAL.ts'
import { NotLanded } from './NotLanded.ts'
import { PATCH_SINKS } from './PATCH_SINKS.ts'
import { REACTIVE_BRAND } from './REACTIVE_BRAND.ts'
import { recordWrites } from './recordWrites.ts'
import { currentScope, runInScope, type Scope } from './scoping.ts'
import {
    CHECK,
    CLEAN,
    DIRTY,
    detachProbes,
    dropProbeReader,
    newSubscriber,
    type Subscriber,
    TRACKING,
    type Tracked,
    track,
    trackProbe,
    truncate,
    untracked,
} from './tracking.ts'
import { watchOver } from './watch.ts'

// The shape of a `transform`, named because the registry names it and because 4.6 is
// written over it: the `Failures` arm of the return is the refusal, not an error channel
// beside it.
export type Transformer<Accepted, Stored, Failures = never> = (
    value: Accepted,
) => Stored | Failures

// Both halves, and no way to spell either alone (8.1). `get` answering `undefined` is a miss
// (8.17), so the miss is in `get`'s type rather than in `Stored`: a store over a value with a body
// is typed by what the body produces, and a `Store<T | undefined>` there could not be written.
export type Store<Stored> = {
    get: () => Stored | undefined | Promise<Stored | undefined>
    set: (value: Stored, retention: { ttl: number }) => void | Promise<void>
}

// ONE SIGNATURE, NOT A UNION OF TWO. A union of signatures with different arities gives an arrow no
// contextual type, so `identity: (turn) => turn.text` read its parameter as `any`. A projection
// declares one parameter and is still assignable here; 5.3 tells the two apart by that arity.
export type Identity<Stored> = (next: Stored, previous: Stored) => unknown

// `Failures` IS INFERRED FROM `transform`, which is what makes `s.error` and `s.isError`
// typed rather than `undefined`. 4.6 has a transform refuse by RETURNING, so its return
// type is the one place a value's failures are declared — naming them a second time on the
// factory would be a declaration that can disagree with the code.
export type ReactiveOptions<
    Accepted,
    Stored,
    // CONSTRAINED TO `Failed`, and that is the registry's own row — "union of `Failed`" —
    // rather than a convenience. Unconstrained, inference against `Stored | Failures`
    // takes the WHOLE return type into `Failures`, so `s.error()` came back typed
    // `number | Failed<…>` and `.data` did not exist on it. The bound is what tells the
    // two halves of that union apart.
    Failures extends Failed<string, unknown> = never,
    // `never` on every overload but the keyed ones, which is what makes `args` unspellable
    // on the unkeyed form (11.42): its field type collapses to `never` there.
    Args = never,
> = {
    // RULEBOOK 11.41, 11.28, 11.69: the gate on a keyed value's args — what it returns is what the
    // body is handed, and the key was taken before it ran (11.26).
    args?: [Args] extends [never] ? never : Schema<Args>
    // RULEBOOK 5.3: discriminated by arity — one parameter is a projection compared by
    // `!==`, two is a comparator answering directly.
    identity?: Identity<Stored>
    // RULEBOOK 6.4 through 6.12: the life of a production, in milliseconds. Inert on a
    // value with no producer (6.8), which is decided once — see `expiryFor`.
    ttl?: number
    // RULEBOOK 4.3: THE GATE ON THE WAY IN, and it runs FIRST — before `transform`, on
    // the settled value, on every way in alike: a write, a publish (9.8, 9.12), what a
    // body produced (11.47) and what an adoption mirrors (11.48).
    schema?: Schema<Accepted>
    // RULEBOOK 4.6, 4.7: runs untracked, on the settled value, once per materialisation,
    // and refuses by RETURNING a `Failed` rather than by throwing. A throw here would be
    // indistinguishable from the body having failed, and 4.9 has a refused write mint
    // nothing where a failed producer (2.3) may still have something to say.
    transform?: Transformer<Accepted, Stored, Failures>
    // RULEBOOK 6.1 through 6.3, 6.16: how many past productions are retained beside the standing
    // one, for `s.history` to replay. On a streaming producer it bounds the CLOSED runs a
    // cursor can replay (6.17), which is the stream's own ring rather than this one.
    history?: number
    // RULEBOOK 5.9, 5.13: a change reaches a reader immediately and then at most once per
    // window. Declaring this beside `debounce` is refused at construction (5.15).
    throttle?: number
    // RULEBOOK 5.9, 5.14: a change reaches a reader once the changes stop.
    debounce?: number
    // RULEBOOK 11.44, 11.45: what a `Selection` matches on, and the one selector that reaches
    // across values. The function form is handed the entry's args, and `undefined` on a value
    // that has none — which is the only value it is ever `undefined` on.
    tags?: string[] | ((args: ArgsOf<Args>) => string[])
    // RULEBOOK 8, 9.11, 11.43: where the value lives when the process does not. The function form
    // is handed the entry's args, so each key of a `Keyed` has a store of its own.
    store?: Store<Stored> | ((args: ArgsOf<Args>) => Store<Stored>)
    // RULEBOOK 11.32, 11.34: one value for the whole process rather than one per request. Inert in a
    // browser, where the process IS the scope.
    global?: boolean
    // RULEBOOK 5.23, 32.33: what tells one element from another. The property-name form is the one
    // that crosses a wire (18.19) — a function has no serialisation.
    by?:
        | (keyof ElementOf<Stored> & string)
        | ((element: ElementOf<Stored>) => unknown)
}

// What a function-form option is handed: the entry's args, or `undefined` on a value whose body
// takes none (11.45).
type ArgsOf<Args> = [Args] extends [never] ? undefined : Args

// `unknown` on a value that is not an array, where `by` has no element to key and names no property.
type ElementOf<Stored> =
    NonNullable<Stored> extends readonly (infer Element)[] ? Element : unknown

// `Produced` is the fourth parameter and RULEBOOK 1.2 is what it means: the unit the
// producer yielded, which is `Stored` for every producer but a stream, and one chunk for a
// streaming producer (9.2). It defaults to `Stored`, so the parameter is invisible to
// everything that is not a stream.
export type Reactive<
    Stored,
    Accepted = Stored,
    Failures = never,
    Produced = Stored,
> = {
    // RULEBOOK 2.2: throws where nothing has landed. Move 7 is what makes this `Stored`
    // rather than `Stored | undefined` — the absence moved to `peek`.
    (): Stored
    peek(): Stored | undefined
    busy(): boolean
    ready(): boolean
    error(): Failures | undefined
    // 3.1: the narrowing, and it takes the error rather than reading one — `s.error` is
    // the probe, this is the type guard over whatever was caught.
    isError<Name extends string>(
        error: unknown,
        name: Name,
    ): error is Extract<Failures, { name: Name }>
    // Gated by `identity`, and local. The divergence that once split by PRODUCER
    // splits by MEMBER instead. Hands back the refusal where a gate refused the write (9.5).
    // A `Reactive` IS IN THE UNION because 11.62 adopts one rather than storing it, and it is
    // spelled out rather than left to `PromiseLike`: a `Reactive` satisfies that (1.4), and
    // taking it through that arm is exactly the settle-to-a-snapshot 1.6 refuses.
    set(
        value: Accepted | PromiseLike<Accepted> | Reactive<Accepted>,
        // biome-ignore lint/suspicious/noConfusingVoidType: same reason as `watch` below — a `set` that returns nothing infers `void`, and 9.5's refusal is the other arm.
    ): void | Failures
    // Ungated, and fans out. Returns the production's ordinal, or the standing one
    // where the write collapsed (RULEBOOK 9.8 generalised), or the refusal (9.5). A load
    // hands back the ordinal it started from: what it will be refused with is not known yet.
    publish(value: Accepted | PromiseLike<Accepted>): number | Failures
    patch(mutate: (value: Stored) => void): void
    refresh(): void
    invalidate(): void
    // biome-ignore lint/suspicious/noConfusingVoidType: `void` is the RETURN POSITION of an author's effect, and it is load-bearing. `undefined` there refuses `(v) => { read(v) }` — a block body returning nothing infers `void`, which is not assignable to `undefined` — so the rule's fix would reject the ordinary effect.
    watch(effect: (value: Stored) => void | (() => void)): () => void
    // 2.5, 2.6: the retained productions, replayed to the depth asked for, and then live.
    // `Stored` RATHER THAN `Produced`, which are the same type on every producer but a streaming
    // one: 6.17 has a run enter the ring as its accumulation at close, so the past of a stream is
    // its finished runs where a cursor over the VALUE walks chunks (2.7, 1.2).
    history(replay?: number): History<Stored>
    // 2.7: the production in flight, and then what follows it.
    [Symbol.asyncIterator](): AsyncIterator<Produced>
    then<Result>(
        onSettled?: (value: Stored) => Result | PromiseLike<Result>,
        onFailed?: (error: unknown) => Result | PromiseLike<Result>,
    ): Promise<Result>
    catch<Result>(
        onFailed: (error: unknown) => Result | PromiseLike<Result>,
    ): Promise<Stored | Result>
    finally(onSettled: () => void): Promise<Stored>
}

// The standing adoption: what is adopted, and the way to stop mirroring it.
type Adoption = { source: Cell; stop: () => void }

// THE WINDOW A `throttle` OR A `debounce` HOLDS OPEN (RULEBOOK 5.9). One field on the
// cell rather than five, allocated only where a value declared one — the shape `adoption`
// already uses, and for the same reason.
//
// WHAT A WINDOW CAPS IS THE WAKE, NEVER THE PRODUCTION (5.10). Every write still mints:
// the ordinal moves, the ring takes it, and a cursor walking retention is handed every one
// of them (5.11). What waits is the value a READER sees and the cascade that tells it so,
// which is the whole of 5.9's "how often a value changes for a reader".
//
// WHAT IT COSTS EVERY VALUE THAT NEVER CAPS: one field load and one branch on the write
// path, plus `serve` as a frame rather than five stores inline. Measured at 0.99x -> 1.08x
// against the hand-written arm on `publish into a capped ring`, consistent across three
// runs over a 0.7% floor — about 1.3 ns on a 14.7 ns op. Moving the comparison target
// behind the gate did not recover it, so it is the frame and the branch rather than a
// wasted load. Inlining `serve` into the uncapped arm would buy it back for a second copy
// of the reader-visible transition, and this file has already paid for one of those: the
// trade is stated rather than taken, 1.3 ns being nowhere near perception.
type Cap = {
    // 5.13 against 5.14, and the only difference between the two mechanisms: a throttle
    // lets the leading change through and holds what follows, a debounce holds everything
    // until the changes stop.
    leading: boolean
    ms: number
    timer: ReturnType<typeof setTimeout> | null
    // The production the window is holding back. `holding` is a field rather than a test
    // against `held`, because `undefined` is a value an app can write and so cannot carry
    // the absence.
    held: unknown
    holding: boolean
    // WHAT THE IDENTITY GATE COMPARES AGAINST. On every uncapped value that is `cell.value`
    // and the two are one thing; a window moves the last production MINTED apart from the
    // last one RELEASED, and comparing against the released one would collapse a production
    // 5.10 forbids dropping — A, B, A inside one window is three productions, and only the
    // third's own predecessor makes it a repeat.
    minted: unknown
    // A BODY RUN THE WINDOW IS HOLDING BACK (5.12), against `holding`'s production. The two
    // are separate flags because they can stand together: a stream has a body AND tells its
    // chunks through the window (5.18), so one close can owe a run and a telling at once.
    owed: boolean
    // 5.25 — A RELOAD THE WINDOW IS HOLDING BACK: a refresh made inside it, started when it closes.
    // Started there rather than owed like a run, because 7.11 reloads whether or not anything reads
    // and an owed run waits for a read to pull it.
    reloading: boolean
}

// A VALUE'S STORE AND WHAT ITS WRITES ARE DOING, allocated only where a `store` was declared.
//
// 8.10: ONE WRITE IN FLIGHT AND ONE PENDING. A production arriving while a write is out replaces
// the pending value rather than queueing behind it: a slow store handed every intermediate is doing
// work nobody can observe, and a queue is how it grows without bound behind a fast writer.
type Persisted = {
    store: Store<unknown>
    // 8.13, taken once: the value's own `ttl`, and infinity where it declares none.
    ttl: number
    // Set while a restore mints its production, so what was just read is not written back (8.8).
    restoring: boolean
    writing: boolean
    pending: boolean
    // THE NEWEST VALUE THE APP HAS HANDED THE STORE, standing until the store confirms it. It is
    // what `pending` sends next, and what 8.18 serves a re-read in place of calling `get`.
    unconfirmed: unknown
}

// A STREAMING PRODUCER'S OWN STATE (9.2, 9.3, 9.20), and `null` on every value whose body is
// not an async generator — the shape `cap` and `adoption` already use.
//
// THE ACCUMULATION IS PUSHED INTO AND MATERIALISED ON THE READ. A chunk is one push and one
// cascade; the copy a reader is handed is taken by the read that follows, so a hundred
// chunks between two reads are one copy rather than a hundred (9.3). The copy is FRESH per
// chunk count and has to be: a reader holding an earlier snapshot still holds what it read,
// and a value derived from this one compares by reference — the live buffer handed out would
// be collapsed at every derived identity gate after the first chunk.
//
// WHAT THAT COSTS WHERE A READ FOLLOWS EVERY CHUNK is a copy of the accumulation per read,
// and a reader woken per chunk made that a copy per chunk: twenty thousand chunks landing in
// one task took 61 ms against 1.9 ms for the hand-written arm. 9.23 is what bounds it — the
// wake is held to one per task, which is the unit a browser paints between, so the reads it
// drops were never visible. A reader that reads per chunk on its own, unwoken, is still a
// copy per read.
type Stream = {
    // The accumulation of the run being served — and the same array as `ring`, so a cursor
    // walks the chunks this holds rather than a second copy of them.
    chunks: unknown[]
    // WHICH ACCUMULATION `value` STANDS FOR, as a version rather than a chunk count: a patch
    // changes the accumulation without changing its length (9.27), and a write stands at the
    // version it was made at until the accumulation moves past it (9.25). -1 where nothing
    // has been materialised.
    version: number
    materialisedAt: number
    // WHETHER `value` IS A WRITE rather than a materialisation, while `materialisedAt` stands. A value
    // forwarding this stream serves the write the way it would have served a production (11.60).
    written: boolean
    // HOW MANY CHUNKS A READER HAS BEEN TOLD OF. Every chunk as it lands, without a cap; with one,
    // only what the window has released (5.19) — the rest are in `chunks` for a cursor (5.11) and
    // out of what a read materialises until the release.
    visible: number
    // The run in flight, told to return when a newer run supersedes it.
    iterator: AsyncIterator<unknown> | null
    // WHICH RUN IS CURRENT, and only a new run moves it. Apart from `generation`, which every
    // write moves so that a load it overtook lands nowhere — a write over a stream stands beside
    // the stream (9.25) rather than superseding it, and sharing the counter stopped the stream.
    run: number
    // 9.23: chunks have landed that the readers have not been told about, and the value is
    // already in `WAKING` — so the next chunk in this task pushes and does nothing else.
    waking: boolean
    // A probe moved under the held wake — the first chunk making the value ready, or one
    // clearing a standing error — and the wake owes it to the guards as well.
    probesOwed: boolean
    // THE STREAM THIS ONE FORWARDS (11.15), and `null` on a value that produces its own. A
    // value adopting a stream IS that stream to a cursor, a guard and an await, so it holds
    // the adopted value's buffer and ring rather than copies — and this is what stops a
    // trigger on it starting its body as though the body were the generator.
    source: Cell | null
    // How far the forwarding value's ordinals run ahead of the adopted value's, fixed when
    // the forwarding begins so the adopter's cursor positions go on from its own.
    ordinalOffset: number
    // 6.17'S RING, AND IT IS NOT THE CHUNK BUFFER. `chunks` is the run being built and is what
    // `ring` points at, so a cursor over the value walks chunks (2.7); this holds what CLOSED
    // runs accumulated to, one entry per run. Two buffers because they count different things:
    // `ordinal` counts chunks, `runs` counts productions, and a cursor reading either by ordinal
    // needs its own base or it is handed `undefined` on its next turn.
    past: unknown[]
    runs: number
    // WHETHER WHAT IS SERVED IS A RUN THAT CLOSED, which is the only accumulation a deadline
    // reaches (6.17). A run in flight has minted nothing, so `expiry.at` says nothing about it —
    // without this the standing arm reads `at` as 0 and drops the value on its first read.
    closed: boolean
    // The `Retained` a history cursor reads, made once per stream and mutated as runs close —
    // cursors hold it, so a fresh object per close would leave every live one reading the old.
    // Its `readers` are its own: a run closing wakes the cursors waiting on it and nothing else,
    // where the cell's readers are woken per chunk by the wake a stream already holds (9.23).
    view: Retained | null
}

function newStream(source: Cell | null): Stream {
    return {
        chunks: EMPTY_RING,
        version: 0,
        visible: 0,
        materialisedAt: -1,
        written: false,
        iterator: null,
        run: 0,
        waking: false,
        probesOwed: false,
        source,
        ordinalOffset: 0,
        past: EMPTY_RING,
        runs: 0,
        closed: false,
        view: null,
    }
}

// 6.17: the accumulation a run closed with, entering the ring as one production. Made on the
// first close rather than at construction, so a stream nothing ever asks the past of allocates
// neither the ring nor the view.
function historyView(cell: Cell, stream: Stream): Retained {
    let view = stream.view
    if (view === null) {
        view = {
            ordinal: 0,
            probeReaders: [],
            ring: stream.past,
            ringBase: 0,
            ringDepth: cell.ringDepth,
            servable: false,
            // NULL THOUGH THIS IS A STREAM'S: `stream` on a `Retained` says "the ring is the
            // accumulation being built", and this ring is the opposite of that — closed runs,
            // bounded by `ringDepth` and read like any other value's past.
            stream: null,
            value: undefined,
            readers: [],
        }
        stream.view = view
    }
    return view
}

// A RUN HAS CLOSED, so what it accumulated is a production (6.17). 6.20 keeps a failed or
// superseded run out by never reaching here, and 6.21 falls out of the same thing: the ring holds
// closed runs alone, so a replay cannot run past the last one.
function retainRun(cell: Cell, stream: Stream): void {
    const accumulated = heldValue(cell)
    // 6.18: an `undefined` production never enters the ring, and a stream that closed with
    // nothing to show is the shape that makes one.
    if (accumulated === undefined) return
    const view = historyView(cell, stream)
    stream.closed = true
    stream.runs += 1
    view.ordinal = stream.runs
    view.value = accumulated
    view.servable = true
    // 6.17 IS WHERE A STREAM'S CLOCK STARTS. The run in flight has produced nothing, so it has
    // no deadline; the close is the mint, exactly as `produce` is on every other producer.
    const expiry = cell.expiry
    const mintedAt = expiry === null ? 0 : Date.now()
    if (cell.ringDepth > 0) {
        if (stream.past === EMPTY_RING) stream.past = []
        stream.past.push(accumulated)
        if (expiry !== null) expiry.minted.push(mintedAt)
        // The same amortised trim as a value's ring: grow to twice the depth and move once,
        // rather than shifting every entry per close. THE TWO ARRAYS ARE ONE INDEX, so
        // `minted[i]` pairs with `past[i]` through every trim.
        if (stream.past.length >= cell.ringDepth * 2) {
            const dropped = stream.past.length - cell.ringDepth
            stream.past.splice(0, dropped)
            if (expiry !== null) expiry.minted.splice(0, dropped)
            view.ringBase += dropped
        }
        view.ring = stream.past
    }
    if (expiry !== null) {
        expiry.at = mintedAt
        // A closed run replaces what 6.13 released, so the value is no longer waiting for one.
        expiry.dropped = false
        armNext(cell, expiry)
    }
    // The cursors waiting on a run rather than on a chunk, and nothing else: these readers are
    // not on the cell, so no binding is woken a second time by a close.
    const waiting = view.readers
    for (let index = 0; index < waiting.length; index += 1) {
        const reader = waiting[index] as Subscriber
        if (reader.alive) reader.notify()
    }
}

// The prototype every `async function*` has, and so the declaration 9.20 reads — once, at
// construction. Taken from a literal because the constructor has no global name.
const ASYNC_GENERATOR_FUNCTION = Object.getPrototypeOf(async function* () {})

// Exported for what wraps a body and has to keep its kind — `args` in `Keyed.ts`.
export function isStreamBody(body: (args: never) => unknown): boolean {
    return Object.getPrototypeOf(body) === ASYNC_GENERATOR_FUNCTION
}

// THE INTERNAL FACE, AND A SECOND OBJECT. With the fields on the callable itself, every
// one was a property added to a FUNCTION at construction, and that was most of what a
// value cost to make: moving them here took `construct a value` from 123 ns to 87 under
// JSC and from 101 to 83 under V8, and a derived value's construction, a chain and a
// layered DAG 7-13% with it. Nothing measured moved the other way. The callable captures
// its record, so a read is one context load — the hand-written arm's one captured
// variable — and a member reaches the record through `CELL`, one load ahead of what it
// did before.
//
// THE FIELD COUNT SITS ON A VM BOUNDARY AND IT IS NOT A LEVER. Both engines give an
// object a fixed inline slot budget and spill the rest to an out-of-line store, and this
// record is over it — so the count moves numbers that have nothing to do with the work.
// Two independent measurements say the same thing from opposite ends. Taking `Cell` to
// 38 is worth ~11% of `construct a value` and ~6-9% of the derived case, and it does not
// matter HOW the four go: a consolidation into one record and four fields simply deleted
// buy the same number, so the consolidation is not what pays. Going the other way,
// 42 -> 46, is FREE — above the budget the out-of-line store already exists. And dropping
// ONE field moved chain 20 and both layered DAGs +4.2% under V8 while moving nothing
// under JSC; adding a DEAD boolean back put all three within 0.6%, which is the proof it
// was layout and not work — that same dead boolean then cost the probe walk 6-7%.
//
// So the boundary is worth KNOWING and not worth engineering around. Adding a 43rd field
// costs nothing; getting under costs a structural change that the next field added here
// silently undoes, and it re-rolls in a different direction for every row. If
// construction ever needs that 11%, shed fields — do not build machinery to shed them.
// And when a V8-only move of this size shows up on a graph row, the first thing to check
// is whether the field count changed.
class Cell {
    // ARRAYS, not sets. The mark walk walks this per write and a set's iterator
    // allocates; removal is O(n) against a reader count that is small by construction.
    declare readers: Subscriber[]
    // Who asked about this value's PROBES — a different edge from `readers`, and see
    // `markProbes` for what that buys.
    declare probeReaders: Subscriber[]
    declare sources: Cell[]
    // The values whose PROBES this body asked about — a `Cell` is a `Subscriber`, so it
    // carries the reader half of the probe edge as well as the source half.
    declare probeSources: Cell[]
    declare cursor: number
    declare label: string
    declare body: ((args: unknown) => unknown) | null
    declare args: unknown
    declare value: unknown
    declare landed: boolean
    // WHETHER A READ MAY ANSWER WITH `value`. Implies `landed`, and is false over a landed value
    // a trigger, an abort or an adoption has stopped serving — which is the state `landed`
    // alone cannot say.
    declare servable: boolean
    // `state === CLEAN && servable` — the whole of "this read can return the field",
    // maintained rather than recomputed. A read is the hottest path in the design and it
    // was three loads and three branches to decide.
    //
    // THE INVARIANT IS ONE-DIRECTIONAL and that is what makes it safe to maintain by
    // hand: `true` is written only where all three are known to hold, and every
    // transition that can break one of them writes `false`. So a site that forgets to
    // set it true costs a frame on the reads that follow and cannot serve a wrong value,
    // which is the opposite of how a maintained flag usually fails.
    declare direct: boolean
    declare loading: boolean
    declare failure: unknown
    // `null` IS the default — see `comparatorFor`.
    declare identityFn: ((next: unknown, previous: unknown) => boolean) | null
    declare transform: ((value: unknown) => unknown) | null
    // `null` on every value that declares no `schema`, which keeps the gate off the write
    // path of everything that did not ask for one.
    declare schema: Schema<unknown> | null
    declare ringDepth: number
    declare ring: unknown[]
    // How many productions have fallen off the FRONT of the ring, so `ring[index]` carries
    // ordinal `ringBase + index + 1`. A cursor holds an ordinal and finds its place from
    // this, which is what lets the ring be trimmed without a cursor losing its position
    // or repeating one (2.5, 9.10).
    declare ringBase: number
    // `null` on every value that declares no `ttl`, and on every value 6.8 makes it inert
    // for. Its presence is also what holds `direct` false — see `serve`.
    declare expiry: Expiry | null
    declare ordinal: number
    declare generation: number
    declare alive: boolean
    declare isEffect: boolean
    declare isMirror: boolean
    declare adopter: Tracked | null
    // `CLEAN`, `CHECK` or `DIRTY` — see `tracking.ts`. Stamped on every transitive
    // reader BEFORE anything runs, so a body that reaches a source which has not caught
    // up yet pulls it forward; `running` is what stops a body already on the stack being
    // re-entered.
    //
    // ONE RUN PER NODE PER WRITE is the contract, and the state carries it without a
    // cascade counter: a node that has run is `CLEAN`, and only a source PRODUCING can
    // mark it again — which a source it already read cannot do, because reading it is
    // what resolved it.
    declare state: number
    declare running: boolean
    // 2.14: A RUN THAT ABORTED ON A VALUE THAT HAD NOT LANDED, and is owed the rest of itself
    // when that value arrives. Push-pull leaves a marked body for the read that wants it, and
    // that is right for a body which RAN — this one did not, so nothing downstream can pull it:
    // a reader guarding on `ready()` asks the probe edge and never the value, and the guard would
    // answer false for as long as nobody read through it.
    declare aborted: boolean
    // WHAT THIS VALUE'S BODY HANDED BACK, where it handed back another `Reactive`
    // (11.12). `null` on every value that is not adopting, which is nearly all of them —
    // one field rather than two, and the record is allocated only where there is one.
    declare adoption: Adoption | null
    // `null` on every value declaring neither `throttle` nor `debounce`, which is nearly
    // all of them.
    declare cap: Cap | null
    // `null` on every value declaring no `tags`, which keeps `markProbes` from looking up a
    // selection signal for any of them.
    declare tags: string[] | null
    // `null` on every value declaring no `store`, which is what keeps `serve` from persisting.
    declare store: Persisted | null
    // 5.23 — held as declared rather than as a function, so the property name is still there to send.
    declare by: string | ((element: unknown) => unknown) | null
    // The probe pass this cell was last visited in. See `walkBusy` and `walkReady`.
    declare probePass: number
    // `OWES_NOTHING`, `OWES_ABOVE` or `OWES_RELOAD` — what an `invalidate` left for the next read
    // to do. See `invalidateOne`.
    declare owes: number
    // The value this record is the state of — what `NotLanded` names as its source.
    declare callable: Reactive<unknown> | null
    // `null` on every value whose body is not an async generator, which is nearly all.
    declare stream: Stream | null
    // WHETHER A READ MAY EVER TAKE THE FIELD STRAIGHT, fixed at construction: no expiry to
    // check and no accumulation to materialise. `setDirect` reads this one field where it
    // would otherwise read one per mechanism that needs the read to go a frame in.
    declare plain: boolean
    // NOTHING STANDS BETWEEN A SETTLED WRITE AND `produce`: no `schema`, no `transform`, and no
    // stream whose writes stand apart from its chunks (9.25, 9.26). One field where the write and
    // the recompute each tested two, maintained where a forwarded stream comes and goes.
    declare bareWrite: boolean
    // EVERYTHING A GATED WRITE WOULD OTHERWISE ASK, IN ONE FIELD: no cap holding the
    // production back, no expiry, no ring to append to, no store to persist through, no
    // declared `identity`, and `bareWrite`'s own three. A value carrying none of them has a
    // `produce` -> `serve` -> `cascade` that reduces to three stores and a mark — which is
    // what `SIMPLE_PROTOTYPE.set` spells out rather than calls.
    //
    // IT SELECTS A PROTOTYPE AND IS NOT READ ON THE WRITE PATH. See `SIMPLE_PROTOTYPE`.
    //
    // MAINTAINED, NOT FIXED: three of the fields under it move after construction —
    // `bareWrite` and `plain` where a forwarded stream comes and goes, `identityFn` where an
    // adoption takes the inner value's. `simpleShape` is called at each of those.
    declare simple: boolean
    // 11.32 — THE SCOPE THIS VALUE WAS BUILT IN, and so the one its body runs under. `undefined` in a
    // browser, and on a server for a value built outside any request.
    declare scope: Scope | undefined
    // 11.34, 13.13 — one value for the process, and so inside every scope a selection is made in. An
    // entry of a `global` keyed value is one too, whichever request first reached it.
    declare global: boolean

    constructor(
        label: string,
        body: ((args: unknown) => unknown) | null,
        args: unknown,
        options: ReactiveOptions<unknown, unknown, never> | undefined,
        streaming: boolean,
    ) {
        // Every field, in one order, `undefined` included.
        this.readers = []
        this.probeReaders = []
        this.sources = []
        this.probeSources = []
        this.cursor = 0
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
        this.transform = (options?.transform ?? null) as
            | ((value: unknown) => unknown)
            | null
        this.schema = (options?.schema ?? null) as Schema<unknown> | null
        // THE RING HOLDS THE STANDING PRODUCTION TOO, so `history: n` is a ring of n + 1. A value
        // declaring none has no ring at all, and a cursor answers the standing production from
        // `value` (6.16) — which is what keeps every write off the ring's push.
        const history = options?.history ?? 0
        this.ringDepth = history > 0 ? history + 1 : 0
        this.ring = this.ringDepth > 0 ? [] : EMPTY_RING
        this.ringBase = 0
        // 6.8 DECIDED ONCE, here rather than per production: a body or a ring is what makes
        // a value a producer, and a plain state is the one this must not reach. See
        // `expiryFor`.
        this.expiry = expiryFor(
            options?.ttl,
            // A store is a producer too (8.2): there is somewhere to get the value back from, so
            // `ttl` on a value holding one drops rather than being inert.
            body !== null || this.ringDepth > 0 || options?.store !== undefined,
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
        const store = options?.store
        this.store =
            store === undefined
                ? null
                : {
                      store: (typeof store === 'function'
                          ? store(args as never)
                          : store) as Store<unknown>,
                      ttl: options?.ttl ?? Number.POSITIVE_INFINITY,
                      restoring: false,
                      writing: false,
                      pending: false,
                      unconfirmed: undefined,
                  }
        this.by = (options?.by ?? null) as
            | string
            | ((element: unknown) => unknown)
            | null
        this.probePass = 0
        this.owes = OWES_NOTHING
        this.isEffect = false
        this.isMirror = false
        this.adopter = null
        this.callable = null
        this.stream = streaming ? newStream(null) : null
        this.plain = this.expiry === null && this.stream === null
        this.bareWrite =
            this.schema === null && this.transform === null && !streaming
        this.simple = false
        this.scope = currentScope()
        this.global = options?.global === true
        simpleShape(this)
    }

    notify(): void {
        run(this)
    }
}

// What a member's `this` is, and the one way from the value an app holds to its record.
type Callable = { [CELL]: Cell }

// 5.15 is a BUILD error and there is no build yet, so it lands at construction — the
// earliest moment that exists, and the one the app still has a stack for. Naming the value
// is the clause's own requirement; without it a page declaring both on one of forty values
// says only that something did. One statement for both producers of a window: a value's
// (5.9) and a keyed value's, which caps starts rather than wakes (5.20).
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

function capFor(
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

// THE DEFAULT IS THE REFERENCE, and `structural` is exported for an app to pass.
//
// THE CASE FOR A STRUCTURAL DEFAULT IS REAL: a reload that fetched an equal
// payload builds a FRESH object, so a reference compare never fires and every reader
// wakes on a value that did not change. What decides it against that is the cost on
// the shape an app actually holds — a compare walks the whole value on EVERY write,
// where the wake it avoids is paid only when the payload really is equal. A grid of
// rows re-assembled per recompute pays the deep walk every time and collapses never.
//
// So the framework takes the cheap, predictable default — `===` is what JavaScript
// means by "the same value" — and the app names `identity: structural` on the values
// where re-materialisation is the common case. 5.5's "not equal wherever it cannot
// decide" is unchanged; it is just no longer the default reading.
//
// `identity` is discriminated by ARITY (5.3), once, at construction — not per compare.
//
// NULL IS THE DEFAULT, not a function that implements it. `produce` compares against
// `null` and calls `Object.is` directly, which takes an INDIRECT call off the write path:
// the site is polymorphic across the default, a projection closure and whatever an app
// passed, so it is not one an engine can speculate through. The saving is the indirection
// rather than the comparison — `Object.is` is itself the fastest spelling of it.

function comparatorFor(
    identity: Identity<unknown> | undefined,
): ((next: unknown, previous: unknown) => boolean) | null {
    if (identity === undefined) return null
    if (identity.length >= 2)
        return identity as (next: unknown, previous: unknown) => boolean
    const project = identity as (value: unknown) => unknown
    return (next, previous) => project(next) === project(previous)
}

// `simple` IN ONE PLACE, and the prototype that goes with it. A second copy of this
// conjunction is the drift that would let one of the four sites go on reading `true` after
// the field under it moved — and what the short write would then skip is a cap, a ring or a
// declared `identity`, silently.
//
// THE CALLABLE IS RE-SEATED ONLY WHERE IT IS ON ONE OF THESE TWO. A value that is adopting or
// forwarding a stream carries a prototype of its own and keeps it; the field is still
// maintained, so the seat it lands on when the adoption drops is the right one.
function simpleShape(cell: Cell): void {
    cell.simple =
        cell.bareWrite &&
        // `plain` carries `expiry === null` and `stream === null` already.
        cell.plain &&
        cell.cap === null &&
        cell.store === null &&
        cell.ringDepth === 0 &&
        cell.identityFn === null
    const callable = cell.callable
    if (callable === null) return
    const seat = Object.getPrototypeOf(callable)
    if (seat !== MEMBER_PROTOTYPE && seat !== SIMPLE_PROTOTYPE) return
    Object.setPrototypeOf(
        callable as object,
        cell.simple ? SIMPLE_PROTOTYPE : MEMBER_PROTOTYPE,
    )
}

// THE EFFECT QUEUE. A mark walk runs no body, so something has to run the ones that
// must: every EFFECT the walk reached lands here and is resolved when the walk is done.
// Derived values are NOT queued — nothing runs them until something reads them, which is
// the whole of push-pull.
//
// An array and a read cursor rather than `shift()`: an effect that writes appends to the
// queue the drain is already walking, and shifting would move every remaining entry per
// take.
// A COUNT RATHER THAN THE ARRAY'S OWN LENGTH, and the array is never truncated.
// `PENDING.length = 0` is what an engine reads as "this array is finished with", and it
// hands the backing store back — so the next write's push allocated one again, on every
// write that reaches an effect. Holding the capacity and moving a cursor over it makes a
// push a plain indexed store.
const PENDING: (Subscriber | null)[] = []
let pendingCount = 0
let pendingAt = 0
// Whether a drain is already in flight. A write made from inside an effect appends to
// the queue the outer drain is walking rather than opening a second one, which is what
// orders a nested write's effects AFTER the one that made it rather than underneath it.
let draining = false
// Whether a drain is already queued for the end of this turn.
let scheduled = false

// THE DRAIN IS DEFERRED AND THE MARK IS NOT, which is the whole of the batching and is
// only safe because reads PULL. A write stamps the graph synchronously, so a read taken
// immediately after one is correct — it resolves what it finds marked. What waits for the
// end of the turn is the part that touches the page.
//
// WITHOUT IT EVERY WRITE IS ITS OWN FLUSH. Measured against a binding that writes on every
// wake: ten writes in one handler were ten `.data` writes where one value is ever seen,
// and three values written together were five, because the binding reading all three ran
// once per write. A diamond was already one — that is what the depth-first resolve buys,
// and this is the same insight one turn up.
function schedule(): void {
    if (scheduled || draining) return
    scheduled = true
    queueMicrotask(flush)
}

function flush(): void {
    scheduled = false
    if (pendingCount === 0 || draining) return
    drainPending()
}

// THE ESCAPE FROM THE BATCH, and batching is what makes it necessary. Everything that has
// to see the page as the writes left it — a test, a measurement, a server rendering to a
// string — needs the turn to end on demand rather than when the microtask queue says so.
// It is the only way to observe an effect in the same turn as the write that caused it.
export function flushSync(): void {
    // IT DOES NOT CLEAR `scheduled`. The microtask already queued will fire and find the
    // queue empty, which costs nothing — where clearing it makes the NEXT write in this
    // same turn queue another one, and a write-then-flush loop pays `queueMicrotask` per
    // write rather than once per turn. Measured at 26.5 ns a write against 14.2 before the
    // flush was there at all.
    // 9.24: a wake a stream is holding for the next task is one this turn ends too.
    if (WAKING.length !== 0) wakeStreams()
    if (pendingCount === 0 || draining) return
    drainPending()
}

// ONE WALK BEFORE ANYTHING RUNS, SETTING A FLAG AND RUNNING NOTHING. Direct readers of
// the cell that produced are `DIRTY` — a source of theirs demonstrably moved. Everything
// beyond them is `CHECK`, because whether the change REACHES them is not known until the
// nodes between have been asked, and 5.2 says a derived value that recomputes to what it
// already held wakes nobody.
//
// This is the ordering fix too: without the walk, A -> B, A -> C, B + C -> D resolves D
// from B while C still holds its old value, and the production D mints there carries
// `b_new + c_old` — a value the system was never in, which reaches `watch`, the ordinal
// and the ring. With it, D's read of C finds C marked and pulls it forward first.
// WHAT A VALUE CARRYING A `ttl` GIVES UP, stated once because four paths restore `direct`
// and a fifth that forgot would serve an expired production with nothing about the output
// saying so. `direct` is the one load and one branch the read path gets; an expiry cell
// is never direct, so every read of it goes a frame in to `readIndirect` — which is
// exactly where 6.5, 6.11 and 6.12 are answered, and is why a value declaring no `ttl`
// never reaches a clock. See `Expiry.ts`. A stream is never direct either, for the same
// shape of reason: its read is where the accumulation is materialised (9.2).
function setDirect(cell: Cell, when: boolean): void {
    cell.direct = when && cell.plain
}

function markReaders(cell: Cell, wanted: number): void {
    const readers = cell.readers
    for (let index = 0; index < readers.length; index += 1) {
        const reader = readers[index] as Subscriber
        // A mark never weakens, and stopping where one is already at least this strong
        // keeps the walk O(V) rather than O(paths) over a shared subgraph. Skipping one
        // that is RUNNING is what stops a body re-marking itself when a source it pulled
        // forward produces underneath it.
        if (!reader.alive || reader.running || reader.state >= wanted) continue
        // One node VISITED. Past the guard above, so it counts what the walk did rather than
        // what it was offered — the difference between the two is the whole of the O(V) claim.
        WORK.descents += 1
        const was = reader.state
        reader.state = wanted
        if (reader.isEffect) {
            // A MIRROR RUNS HERE rather than at the end of the turn: it carries a VALUE,
            // and a read taken before the drain has to find it. No body runs inside it —
            // the production it mints marks on through this same walk. BUT ONLY WHERE WHAT
            // IT MIRRORS HAS PRODUCED: an adopted DERIVED value reached by this walk is only
            // marked, still holding what it held, and copied here it is copied stale and the
            // reader left clean. That one is queued like any effect, and the drain's `CHECK`
            // pulls the derived body forward before the mirror copies anything.
            if (reader.isMirror && cell.state === CLEAN) {
                reader.state = CLEAN
                reader.notify()
                continue
            }
            // Queued once. An upgrade from `CHECK` to `DIRTY` finds it already there.
            if (was === CLEAN) {
                PENDING[pendingCount] = reader
                pendingCount += 1
            }
            continue
        }
        const below = reader as unknown as Cell
        // Marked is not directly servable, whatever it holds.
        below.direct = false
        // 2.14, AND THE ONLY PLACE PUSH-PULL RUNS A DERIVED BODY. A run that aborted is one that
        // started and did not finish, and what is asking is a GUARD: a reader on the probe edge
        // asks `ready()` and never the value, so no read of its will ever pull this body forward
        // and the guard answers false for as long as the page is open. A reader on the VALUE edge
        // needs none of this — its own read pulls — so this is the probe edge alone, and a body
        // nothing probes stays as lazy as 11.5 makes it.
        if (was === CLEAN && below.aborted && below.probeReaders.length !== 0) {
            PENDING[pendingCount] = reader
            pendingCount += 1
        }
        // 5.12: A CAPPED BODY IS A BARRIER IN THE CASCADE. The mark arrives here and
        // stops — nothing downstream is woken (5.9) and the body does not run, so the
        // load it would have issued is never issued rather than issued and discarded.
        // That is the whole difference between capping a value and capping a body: a
        // value's production has already been handed in and must be retained (5.10),
        // where a body's work has not started yet and 5.12 says not to start it.
        //
        // THE WINDOW IS ARMED HERE BECAUSE THIS IS WHERE A SOURCE PRODUCING IS VISIBLE.
        // A read cannot tell one change from ten, so a debounce armed at the read fires
        // a fixed interval after the first change rather than once the changes stop.
        //
        // THE LOAD IS NOT MEASURABLE. It was the reason to expect a cost here — one more
        // field read per marked node in the hottest walk in the core — and across two
        // runs the abide arm is flat on every graph row: chain 20 at 2.47x against a
        // 2.44x-2.50x baseline, DAG 5x3 at 1.96x against 1.93x, fan-in 100 unchanged. The
        // ratios wobble because the hand-written arm moves with machine state; `below` was
        // stored to on the line above, so this reads a line already in cache.
        const cap = below.cap
        if (cap !== null && below.body !== null) {
            if (windowHolds(below, cap)) {
                cap.owed = true
                // BACK TO CLEAN so the next source production marks it again and re-arms.
                // Left marked it takes this walk's own `state >= wanted` short-circuit,
                // and the changes after the first become invisible to the window.
                below.state = CLEAN
                setDirect(below, below.servable)
                continue
            }
        }
        // Only a node this walk has not reached descends, and only where it HAS a
        // subtree: one already marked is already at least `CHECK`, which is the
        // strongest thing this walk could say, and one with no readers is the shape
        // push-pull makes most of — a fan of a hundred derived values that nothing
        // downstream reads was entering the walk a hundred times to loop over nothing.
        if (was === CLEAN && below.readers.length !== 0)
            markReaders(below, CHECK)
    }
}

// PULL. A `DIRTY` cell runs. A `CHECK` cell asks its sources first and runs only if one
// of them produced — `produce` is what upgrades a reader from `CHECK` to `DIRTY`, so
// "did anything actually reach me" is answered by the mark arriving during the walk
// rather than by comparing versions afterwards.
function resolve(cell: Cell): void {
    const state = cell.state
    if (state === CLEAN) return
    // On the stack already: its value is whatever its run has reached, and re-entering
    // is the cycle guard.
    if (cell.running) return
    if (state === CHECK) {
        const sources = cell.sources
        for (let index = 0; index < sources.length; index += 1) {
            // The CLEAN test is here rather than behind the call: a node this walk did
            // not reach is the common source, and asking it costs a load instead of a
            // frame. A body with a thousand sources of which one moved asks all thousand.
            const source = sources[index] as Cell
            if (source.state !== CLEAN) resolve(source)
            // Resolving that source produced, and the production marked this cell. The
            // rest of the sources are pulled forward by the body's own reads.
            if (cell.state === DIRTY) break
        }
        if (cell.state !== DIRTY) {
            cell.state = CLEAN
            // Nothing it reads moved, so what it already holds is servable again. The
            // mark cleared this on the way down and only here can it come back — a
            // `CHECK` that resolves to nothing never reaches `produce`.
            setDirect(cell, cell.servable)
            return
        }
    }
    cell.state = CLEAN
    run(cell)
}

// An effect whose turn has come and which the drain's `DIRTY` arm did not take. `CHECK`
// is the case eager could not express: the effect was reached by the mark walk, and
// whether anything it reads actually moved is decided here rather than by running it and
// letting it read the same values again.
function resolveEffect(reader: Subscriber): void {
    if (!reader.alive) {
        reader.state = CLEAN
        return
    }
    if (reader.state === CHECK) {
        const sources = reader.sources
        for (let index = 0; index < sources.length; index += 1) {
            const source = sources[index] as unknown as Cell
            if (source.state !== CLEAN) resolve(source)
            if (reader.state === DIRTY) break
        }
        if (reader.state !== DIRTY) {
            reader.state = CLEAN
            return
        }
    }
    // CLEARED BEFORE, not after: `running` is what blocks a re-mark while the body is on
    // the stack, and clearing after would drop a mark a nested write legitimately made.
    reader.state = CLEAN
    reader.notify()
}

// A PROBE MOVED, AND NO VALUE DID. Going loading on a refresh, coming back on a settle,
// losing what there was to serve on an invalidate — each changes what every reader
// DOWNSTREAM reports (11.20's floor) and mints nothing for a cascade to carry.
//
// It walks the VALUE edge downstream to find the cells whose floor moved, and wakes the
// `probeReaders` of each — never their `readers`. That distinction is the whole point: the
// rows painting the value are not woken, and the guards asking about it are.
function markProbes(cell: Cell, pass: number): void {
    if (cell.probePass === pass) return
    cell.probePass = pass
    markAsked(cell.probeReaders)
    // 13.3: a guard over a tag selection asked the SELECTION, so it hears through the selection's
    // signal rather than through this value's own probe readers.
    if (cell.tags !== null) markSignals(cell.tags)
    // The floor of everything built from this one moved with it — what READ it, and what
    // ADOPTED it (11.51), which is on this list as its mirror rather than as itself.
    const readers = cell.readers
    for (let index = 0; index < readers.length; index += 1) {
        const reader = readers[index] as Subscriber
        if (!reader.isEffect) markProbes(reader as unknown as Cell, pass)
        else if (reader.adopter !== null)
            markProbes(reader.adopter as unknown as Cell, pass)
    }
}

function markAsked(asked: Subscriber[]): void {
    for (let index = 0; index < asked.length; index += 1) {
        const reader = asked[index] as Subscriber
        if (!reader.alive || reader.running || reader.state === DIRTY) continue
        const was = reader.state
        reader.state = DIRTY
        if (reader.isEffect) {
            if (was === CLEAN) {
                PENDING[pendingCount] = reader
                pendingCount += 1
            }
            continue
        }
        const below = reader as unknown as Cell
        below.direct = false
        if (was === CLEAN && below.readers.length !== 0)
            markReaders(below, CHECK)
    }
}

// The cascade's shape, for a move no production carries. Safe to share `probePass` with
// `walkBusy` and `walkReady`: this marks and queues, and nothing runs until the drain
// below it, so a probe read can never be inside this walk.
function probesMoved(cell: Cell): void {
    PROBE_PASS += 1
    markProbes(cell, PROBE_PASS)
    if (draining || pendingCount === 0) return
    schedule()
}

// THE CASCADE, WHICH NO LONGER RUNS A SINGLE DERIVED BODY. It marks, and it runs the
// effects the mark reached; everything else is run by the read that wants it.
//
// The drain is INLINE rather than a function of its own, and the common effect is run
// without one either. A write with one watcher is the shape a template makes per slot,
// and it was paying two call frames and two redundant resets that the walk above it can
// decide instead.
function cascade(cell: Cell): void {
    // A DERIVED VALUE NOTHING READS is the shape push-pull creates most of: a fan of a
    // hundred, of which one is read. Testing the length here rather than entering the
    // walk takes a call frame off every one of the other ninety-nine.
    if (cell.readers.length !== 0) markReaders(cell, DIRTY)
    // A write made from inside an effect appends to the queue the outer drain is
    // walking. Opening a second drain here would run the nested write's effects
    // underneath the effect that made it and before that effect had finished.
    if (draining) return
    // NOTHING TO RUN IS THE COMMON WRITE, and it must not pay for the drain. Writing
    // `PENDING.length = 0` unconditionally cost 35 ns on a write with no readers at all
    // — six times the whole op — because a length store is not free even where the array
    // is already empty. Every write in a graph whose effects are all upstream of it
    // takes this arm.
    if (pendingCount === 0) return
    schedule()
}

// THE DRAIN, BEHIND ITS OWN FRAME. A `try`/`finally` in `cascade` is a `try`/`finally`
// on every write, and the arm that needs it is the one that actually has an effect to
// run — so the guard is up there and the handler is down here.
function drainPending(): void {
    draining = true
    try {
        // Re-read `pendingCount` per turn: an effect that writes appends to the queue
        // this loop is walking, and those belong to this drain rather than the next write.
        while (pendingAt < pendingCount) {
            const reader = PENDING[pendingAt] as Subscriber
            // THE SLOT IS RELEASED, THE ARRAY IS NOT. Holding the capacity is what keeps a
            // push a plain indexed store, and a slot left pointing at a drained subscriber
            // holds its `notify` — and through it the effect body and the whole scope that
            // body closed over — until another effect happens to land on that index. A
            // disposed `watch` stayed reachable to the next high-water mark, which on a page
            // is every node the torn-down component built. One store per effect ALREADY RUN,
            // against a body call.
            PENDING[pendingAt] = null
            pendingAt += 1
            // A DIRECT READER OF WHAT WAS WRITTEN is `DIRTY`, which is the overwhelming
            // shape and asks nothing: there is no source to interrogate, because the
            // mark says one of them already produced.
            if (reader.state === DIRTY && reader.alive) {
                reader.state = CLEAN
                reader.notify()
                continue
            }
            resolveEffect(reader)
        }
    } finally {
        // The queue is abandoned rather than carried into the next write: an effect that
        // threw has already stopped its own watch (12.8), and a half-drained queue
        // outliving the throw would run it against a later write's marks. The tail is
        // released for the reason the loop above releases each slot; on the path that did
        // not throw the cursor has already reached the count and this walks nothing.
        //
        // THE MARK GOES WITH THE QUEUE, and that is what abandoning has to mean. A reader
        // left standing at `DIRTY` with nothing holding it takes `markReaders`' own
        // `state >= wanted` short-circuit on every later write, so it is never queued
        // again — one effect throwing left every sibling it had not reached permanently
        // deaf, silently, while the value went on being right. Back to `CLEAN` is the
        // state the next write's mark can reach.
        //
        // AN EFFECT ONLY, THOUGH. The queue is not effects alone: `markReaders` also pushes a
        // derived CELL on 2.14's aborted-body path, and for one of those `state` is not a
        // reminder to run — it IS the pull the next read takes (`state !== CLEAN` is what sends
        // a read a frame in). Forced back to `CLEAN` it is not deaf, it is settled: the read
        // path skips `resolve`, the aborted body is never re-run and the `ready()` guard that
        // queued it answers false for the life of the page — undoing, on any throw anywhere in
        // the drain, exactly what that push was added to repair.
        for (let index = pendingAt; index < pendingCount; index += 1) {
            const abandoned = PENDING[index] as Subscriber
            PENDING[index] = null
            if (abandoned.isEffect) abandoned.state = CLEAN
        }
        pendingAt = 0
        pendingCount = 0
        draining = false
    }
}

// One production. `gated` is the `set`/`publish` split: a gated write that `identity`
// deems a repeat mints nothing and wakes nobody (5.2); an ungated one always mints,
// because two identical messages are two events somebody sent on purpose.
function produce(cell: Cell, produced: unknown, gated: boolean): number {
    const cap = cell.cap
    // THE COMPARISON TARGET IS BEHIND THE GATE, not beside it: `publish` is ungated (5.5)
    // and would otherwise load it and pick an arm on every message for a compare it never
    // makes.
    //
    // 5.10: the gate compares against the last production MINTED. That is the held value
    // on everything that never caps, and `cap.minted` is where a window has moved the two
    // apart.
    //
    // A CAP OVER A BODY MOVES NEITHER. 5.12 caps the RUN there, so the production goes
    // straight out and `capped` — which writes `cap.minted` for a production — is never
    // reached. Read unconditionally, `previous` was `undefined` on every recompute of a
    // capped derived value, so 5.2 collapsed nothing and every reader woke on a value that
    // had not moved.
    // The same test `produce` already picks `capped` by, one frame down.
    if (gated && cell.landed) {
        const previous =
            cap === null || cell.body !== null ? cell.value : cap.minted
        if (
            cell.identityFn === null
                ? // `Object.is` rather than `===` for one case: a repeated `NaN` is the
                  // same value and would otherwise wake every reader forever. Called
                  // rather than spelled out — an engine intrinsifies it, and the
                  // hand-written equivalent measured 0.80 ns against its 0.66 ns on the
                  // same input.
                  Object.is(produced, previous)
                : cell.identityFn(produced, previous)
        ) {
            // The value did not move, so 5.2 mints nothing — but a load in flight is over and
            // `busy` has moved, which a reader that asked about it has to hear. A standing
            // failure is the third probe moving: 4.11 clears it below, and a guard on
            // `error` hears that the same way one on `busy` hears the load ending.
            //
            // 4.11: an ACCEPTED write clears the standing error, and a write the identity gate
            // collapses was still accepted — it produced nothing because the value was already
            // the one being written, not because it failed. Leaving the failure standing left
            // `s.error()` reporting a load that a later write superseded.
            const wasServable = cell.servable
            const settling = settleProbes(cell)
            cell.servable = true
            setDirect(cell, cell.state === CLEAN)
            // THE VALUE EDGE MOVED TOO WHERE THERE WAS NOTHING TO SERVE, whatever the gate
            // says about the payload — the same split `refused` makes, and for the same
            // reason. A read taken while this was unservable THREW, so a body that reached
            // it aborted: it is `CLEAN`, holds nothing, and nothing downstream will ever
            // pull it. Left silent, an `invalidate` whose reload landed the value it already
            // held stranded every value built from it at `ready()` false for the life of the
            // page. Over a value still being served nothing a reader can see moved (5.1) and
            // this stays quiet, which is the arm 5.2 is about.
            if (!wasServable) cascade(cell)
            if (settling) probesMoved(cell)
            return cell.ordinal
        }
    }
    const moved = settleProbes(cell)
    // ONE CLOCK READ PER PRODUCTION, AND ONLY WHERE ONE WAS ASKED FOR. The `null` test is
    // a load and a compare; the `Date.now()` behind it is the part a value declaring no
    // `ttl` must not pay, and hoisting it here is what keeps it to one for a production
    // that both appends to a ring and refreshes the standing deadline.
    const expiry = cell.expiry
    const mintedAt = expiry === null ? 0 : Date.now()
    // 6.18 AND 6.19: AN `undefined` IS SERVED AND NEVER RETAINED. It moves no ordinal, so no cursor
    // is handed one and the ring never holds one — it is not a message, and not a JSON value either.
    if (produced !== undefined) cell.ordinal += 1
    if (cell.ringDepth > 0 && produced !== undefined) {
        // 6.1 append-only, and 6.2 keeps the write O(1) in the depth: push, bump a
        // version, and let the read materialise. Rebuilding the array here is the
        // O(n^2)-over-a-stream shape CLAUDE.md names.
        cell.ring.push(produced)
        if (expiry !== null) expiry.minted.push(mintedAt)
        // AMORTISED O(1), and 6.2 is the clause: raising `history` must not make a write
        // dearer. `shift()` moves every remaining element, so at `history: 500` a publish
        // moved 499 of them — linear in the depth, on every write. Growing to twice the
        // depth and trimming in one bulk move is the same memmove once per `history`
        // writes, and the read shape does not change.
        if (cell.ring.length >= cell.ringDepth * 2) {
            const dropped = cell.ring.length - cell.ringDepth
            cell.ring.splice(0, dropped)
            // THE TWO ARRAYS ARE ONE INDEX and every trim moves both, or `minted[i]`
            // stops pairing with `ring[i]` and the sweep drops live productions by the
            // deadline of ones that fell off years ago.
            if (expiry !== null) expiry.minted.splice(0, dropped)
            cell.ringBase += dropped
        }
    }
    if (expiry !== null) {
        expiry.at = mintedAt
        // A production is what 6.13 released being replaced, so the value is no longer
        // waiting for one (6.12). The timer is armed in `serve` rather than here, where
        // the value is not servable yet and the deadline it holds cannot be read.
        expiry.dropped = false
    }
    // A BODY'S CAP GATED THE RUN, NOT WHAT IT PRODUCED (5.12): the window has already
    // decided this run should happen, and holding its production too would delay it a
    // second window.
    if (cap !== null && cell.body === null)
        return capped(cell, cap, produced, moved)
    serve(cell, produced)
    cascade(cell)
    if (moved) probesMoved(cell)
    return cell.ordinal
}

// WHAT A PRODUCTION ENDS: the load in flight (`busy`) and a standing refusal (`error`, which 4.11
// clears). What it hands back is whether a probe moved — either of those, or `ready`, there having
// been nothing to serve — read BEFORE the change it describes, and it is the probe move the caller
// owes. A plain write on a value already serving moves none of them, which is the common path.
function settleProbes(cell: Cell): boolean {
    const moved = cell.loading || !cell.servable || cell.failure !== undefined
    cell.loading = false
    cell.failure = undefined
    return moved
}

// THE READER-VISIBLE HALF OF A PRODUCTION, which is exactly what a window separates from
// the production itself. One copy, reached from the uncapped write and from the release
// alike — the alternative was a second spelling of the transition, which is the drift this
// file has already paid for once.
function serve(cell: Cell, value: unknown): void {
    cell.value = value
    cell.landed = true
    cell.servable = true
    // THE ONE PLACE `direct` IS SET TRUE ON A PRODUCTION, and it reads the state rather
    // than assuming it: a write can land on a value a mark walk has already reached, and
    // 11.8 has that write STAND without clearing the recompute owed to it.
    setDirect(cell, cell.state === CLEAN)
    // 6.9's ONE ARMING SITE, and it is here because this is the line that makes the value
    // servable — `armNext` reads the deadline off a production that has landed, and from
    // `produce` it would be reading one that had not.
    if (cell.expiry !== null) armNext(cell, cell.expiry)
    // 8.8: every production that reaches a reader is written, and nothing else is — a write the
    // identity gate collapsed never arrives here.
    if (cell.store !== null) persist(cell, cell.store, value)
}

// HOLD OR GO, for everything a window caps — a body's run (5.12), a refresh (5.25), a production
// and a stream's chunks (5.18) — and the window is opened or pushed back either way. 5.13: a
// throttle with no window open lets this one through and opens one, and re-arming inside an open
// one would make it a debounce. 5.14: a debounce holds everything and every arrival pushes its
// window back, so the release is what happens when they stop.
function windowHolds(cell: Cell, cap: Cap): boolean {
    const open = cap.timer !== null
    if (!open || !cap.leading) openWindow(cell, cap)
    return open || !cap.leading
}

// 5.16: the first landing goes through, having nothing to collapse against — and a debounce's
// window is not opened by it, where a throttle's is.
function passes(cell: Cell, cap: Cap): boolean {
    if (cell.landed) return !windowHolds(cell, cap)
    if (cap.leading) openWindow(cell, cap)
    return true
}

// A production's wake goes now or is held for the window's close — the pass-or-hold tail that a
// write (`capped`) and a patch (5.24) share. The window moves `minted` apart from `value` either way.
function wakes(cell: Cell, cap: Cap, produced: unknown): boolean {
    cap.minted = produced
    if (passes(cell, cap)) return true
    hold(cell, cap, produced)
    return false
}

// A stream's chunks: the buffer already has them, so what the window holds is the telling (5.18).
function tellsChunks(cell: Cell, cap: Cap | null): boolean {
    if (cap === null || passes(cell, cap)) return true
    cap.holding = true
    return false
}

// The production has minted; what is left is whether it reaches a reader now or waits for
// the window. Behind its own frame because the uncapped write never arrives here.
function capped(
    cell: Cell,
    cap: Cap,
    produced: unknown,
    moved: boolean,
): number {
    // 5.16 CANNOT BE SATISFIED BY HOLDING THE FIRST LANDING: there is no held value to go
    // on serving, so a reader would get neither the value it had nor the one that arrived
    // — a `debounce` of 300 left a value not ready for 300 ms after construction. A window
    // collapses a RUN of changes and the first landing has nothing to collapse with.
    if (wakes(cell, cap, produced)) {
        serve(cell, produced)
        cascade(cell)
        if (moved) probesMoved(cell)
    }
    return cell.ordinal
}

// HELD FOR THE WINDOW'S CLOSE, which `release` serves. 5.16: `loading` IS "work in flight", and a
// window with something held is exactly that — so the probe answers from the field it already
// reads rather than from a second one. `isBusy` is the leaf a spinner reads every frame and a load
// it did not need was refused there once already.
function hold(cell: Cell, cap: Cap, value: unknown): void {
    cap.held = value
    cap.holding = true
    cell.loading = true
    // Nothing a reader can see moved, and `busy` did.
    probesMoved(cell)
}

// The window closing, and the one wake per window that 5.13 and 5.14 each allow.
function release(cell: Cell, cap: Cap): void {
    cap.holding = false
    const value = cap.held
    cap.held = undefined
    cell.loading = false
    serve(cell, value)
    cascade(cell)
    // The close is a `busy` edge (5.16) even though the value's readiness never moved.
    probesMoved(cell)
}

function releaseHeld(cell: Cell, cap: Cap): void {
    const stream = cell.stream
    if (stream !== null) {
        cap.holding = false
        releaseChunks(cell, stream)
    } else release(cell, cap)
}

function openWindow(cell: Cell, cap: Cap): void {
    // 5.14 NEEDS THIS: a debounce calls in here on every production inside its window, and
    // the reset is what "until the changes stop" means. Without it each write arms its own
    // timer and the first to fire releases — a fixed delay from the FIRST change, which
    // reads identically to a debounce under any run of writes made in one turn.
    if (cap.timer !== null) clearTimeout(cap.timer)
    // `armTimer` for 6.10's reason, which a window shares with a deadline: a timer never holds the
    // process open. The keyed window already armed through it, so the two agree.
    armTimer(cap, cap.ms, () => {
        cap.timer = null
        // 5.25: the reload the window held back, which is the run as well. A production held beside
        // it is served first — the reload re-reads a store that production has not been written to
        // yet, and skipping it dropped the write and left `holding` standing.
        if (cap.reloading) {
            cap.reloading = false
            cap.owed = false
            if (cap.holding) releaseHeld(cell, cap)
            reloadNow(cell)
            if (cap.leading) openWindow(cell, cap)
            return
        }
        // 5.12: the run the window held back. Marking and cascading is all it does — the
        // body is pulled forward by the read that wants it, which is the same laziness
        // every other recompute gets.
        if (cap.owed) {
            cap.owed = false
            cell.state = DIRTY
            cell.direct = false
            cascade(cell)
            return
        }
        // A throttle's window ending with nothing held is the window simply over: the
        // next write leads again. With something held it releases and opens another, so a
        // run of writes wakes once per window rather than twice at every boundary.
        if (!cap.holding) return
        // A STREAM'S WINDOW HOLDS CHUNKS rather than a production, and closing it tells the readers
        // what landed meanwhile. Branched HERE, in the timer, rather than inside `release`: a stream
        // call reachable from `release` sits on the path every `publish` walks through `capped`, and
        // measured 8.4 ns -> 10.5 ns on `publish into a capped ring` under V8 with no stream in it.
        releaseHeld(cell, cap)
        // A write made by one of the effects this release woke has already opened the
        // next window, and opening a second here would leave `cap.timer` pointing at this
        // one while that one goes on to fire and clear it.
        if (cap.leading) openWindow(cell, cap)
    })
}

// THE WAY IN, AND THE ORDER IS 4.3 THEN 4.4: the schema gates, and what it RETURNS is
// what `transform` receives — not the original value. A transform reading the raw input
// where a schema had normalised it is a second answer to what this value holds.
// What it hands back is the ordinal, or the refusal a gate answered with (9.5) — `unknown`
// because the one caller that cares tells the two apart by type.
function accept(cell: Cell, value: unknown, gated: boolean): unknown {
    let checked = value
    if (cell.schema !== null) {
        // 4.5: THE THROW IS CAUGHT AND CONVERTED rather than escaping the write. A schema
        // that threw past this would take down the caller of `s.set`, which is a template
        // expression or an event handler — 4.10 has a refused write fill `s.error`, and
        // nothing about a refusal is exceptional enough to unwind an app for.
        const answer = runSchema(cell.schema, value)
        // 15.8: a schema that refused is a `ValidationError` at 422 — the request parsed
        // and its contents are wrong, which is exactly what a schema that RAN found out.
        if (answer.issues !== null)
            return refused(cell, validationError<Found>(answer.issues))
        checked = answer.value
    }
    const transform = cell.transform
    if (transform === null) return produce(cell, checked, gated)
    // 4.7 — A `transform` RUNS UNTRACKED: a write can be made from inside a tracked body
    // (`watch(() => target.set(…))`, a recompute that writes), and run tracked, the transform's
    // reads were attributed to that reader — which then re-ran on a value it never read, with
    // those reads spliced into its cursor-ordered `sources`.
    const shaped = untracked(transform, checked, undefined)
    // 4.6 AND 4.9: a `transform` that returned a refusal stops the write here — nothing is
    // stored, no production is minted, and the ordinal does not move. The test is behind
    // the `transform === null` arm, so a value that declares none never reaches it.
    if (isFailed(shaped)) return refused(cell, shaped)
    return produce(cell, shaped, gated)
}

// `accept` FOR A STREAM, AND A SECOND COPY OF THE GATES ON PURPOSE. The branch to `standWrite`
// measured 8.4 ns -> 10.9 ns on `publish into a capped ring` under V8 wherever it sat on a
// value's write path — in `accept`, at the top of `produce`, in the `publish` member — though no
// value ever took it; a bare read of `cell.stream` in the same place cost nothing. So a stream's
// writes are reached by a prototype of their own (`STREAM_PROTOTYPE`) and never share a call
// site with a value's. The copy is the two gates in 4.3's order, and a change to either is a
// change to both.
function acceptIntoStream(
    cell: Cell,
    stream: Stream,
    value: unknown,
    gated: boolean,
): unknown {
    let checked = value
    if (cell.schema !== null) {
        const answer = runSchema(cell.schema, value)
        if (answer.issues !== null)
            return refused(cell, validationError<Found>(answer.issues))
        checked = answer.value
    }
    const transform = cell.transform
    let shaped = checked
    if (transform !== null) {
        shaped = untracked(transform, checked, undefined)
        if (isFailed(shaped)) return refused(cell, shaped)
    }
    return standWrite(cell, stream, shaped, gated)
}

// A write to a stream, from its own `set` and `publish`. A load handed to one lands through the
// same gates when it settles, and a newer write supersedes it the way it would on a value.
function writeStream(cell: Cell, value: unknown, gated: boolean): unknown {
    cell.generation += 1
    if (isThenable(value) && !isReactive(value)) {
        const generation = cell.generation
        value.then(
            (settled) => {
                if (cell.generation === generation)
                    acceptIntoStream(
                        cell,
                        cell.stream as Stream,
                        settled,
                        gated,
                    )
            },
            (failed: unknown) => {
                if (cell.generation === generation) refused(cell, failed)
            },
        )
        return undefined
    }
    const answer = acceptIntoStream(cell, cell.stream as Stream, value, gated)
    return typeof answer === 'number' ? undefined : answer
}

// 9.25 AND 9.26: A WRITE OVER A STREAM IS A VALUE, NOT A CHUNK. It stands at the version of the
// accumulation it was made over, and the first chunk or patch that moves the version past it
// puts the accumulation back on the next read — and it mints no ordinal, which is what a cursor
// holds its place by: `ring[i]` is ordinal `ringBase + i + 1`, and an ordinal with nothing in the
// ring behind it handed the cursor `undefined`.
function standWrite(
    cell: Cell,
    stream: Stream,
    value: unknown,
    gated: boolean,
): number {
    // 5.2 against what is served now, which on a stream may not have been materialised yet.
    if (gated && cell.servable) {
        const previous = heldValue(cell)
        if (
            cell.identityFn === null
                ? Object.is(value, previous)
                : cell.identityFn(value, previous)
        )
            return cell.ordinal
    }
    cell.value = value
    stream.materialisedAt = stream.version
    stream.written = true
    const moved = !cell.servable || cell.failure !== undefined
    landChunks(cell)
    cascade(cell)
    if (moved) probesMoved(cell)
    return cell.ordinal
}

// 4.10: WHAT A REFUSED WRITE LEAVES BEHIND is the standing `s.error`, and this is the one
// statement of it — the rejected-load arm in `absorb` reached the same five lines and a
// second copy is the drift this file is arranged against.
//
// ONE STATEMENT FOR EVERY PRODUCER: a refused write, a rejected load, and a body that threw or
// returned a `Failed` in its own run all land here.
//
// WITH NOTHING SERVED THE FAILURE HAS TO PROPAGATE, AND 4.12 IS THE CASE THAT MUST NOT. A read
// of an unservable value throws, so a reader parked on that throw — a `then` waiter, a body that
// aborted — is answered by this failure or by nothing, and it opens a cascade like a production.
// `servable` rather than `landed`: an invalidated value has landed and is unserved (7.8), and
// testing `landed` left the reader its unserve woke parked on `NotLanded` for the life of the
// value. A refusal over a value still being served changes nothing a reader can see, and waking
// there would be a wake on an unchanged value (5.1).
function refused(cell: Cell, failure: unknown): unknown {
    cell.loading = false
    cell.failure = failure
    // BOTH PROBES MOVED AND NEITHER IS ON THE VALUE EDGE: `busy` went false where the load
    // had set it true, and `error` went from nothing to this. A guard that asked about
    // either is woken here or never.
    probesMoved(cell)
    if (!cell.servable) cascade(cell)
    return failure
}

// A load. 4.2: a load given to a write makes the value loaded, at construction and at
// every write alike. `generation` is what makes a stale settle a no-op — a refresh
// landing after an invalidate must not overwrite the newer run's answer.
//
// `answered` IS A BODY'S ANSWER, and 15.5 has one that settles to a `Failed` refuse. A write that
// settles to one is not an answer, and 4.17 stores it as it would a settled one.
function absorb(
    cell: Cell,
    result: unknown,
    gated: boolean,
    answered: boolean,
): void {
    // THE BRAND IS READ BEFORE `then` (RULEBOOK 1.6). A `Reactive` is thenable by 1.4,
    // so a guard written the other way round settles a live value to one snapshot — a write
    // of `other` would hand back `other`'s current value instead of `other`.
    if (!isThenable(result) || isReactive(result)) {
        accept(cell, result, gated)
        return
    }
    const generation = cell.generation
    // A PROBE MOVES WITHOUT A PRODUCTION — 11.22 derives a propagated probe on the read that
    // asks for it rather than pushing it. Going loading
    // changes what every reader downstream reports and mints no value for a cascade to
    // carry, so the flip opens one itself.
    beginLoad(cell)
    ;(result as PromiseLike<unknown>).then(
        (settled) => {
            if (cell.generation !== generation) return
            if (answered && isFailed(settled)) refused(cell, settled)
            else accept(cell, settled, gated)
        },
        (failed) => {
            if (cell.generation !== generation) return
            refused(cell, failed)
        },
    )
}

// ADOPTION. RULEBOOK 11.12: a `Reactive` a body hands back is ADOPTED, and is not stored
// as a value — the outer value serves what the inner one serves and goes on serving it as
// the inner produces. A `Reactive` the app wants to hold as data goes inside a record —
// `reactive({ inner })` — where nothing mistakes it for a production.
//
// IT IS A `watch` OVER THE INNER VALUE, not a third subscriber mechanism: 12.3's narrowed
// form is exactly "run this when that one changes", which is what mirroring is.
//
// 11.66 — THE ONE PLACE `adoption` IS SET, so it is the one place a cycle can form, and refusing
// it here is what lets every walk of the chain be a plain loop to its end. The walk is over the
// inner's chain, which cannot cycle for the same reason, and it runs per adoption rather than per
// read. The refusal is handed back rather than thrown: 11.67 has the two callers answer it
// differently.
function adopt(cell: Cell, inner: Cell): Error | undefined {
    const standing = cell.adoption
    if (standing !== null && standing.source === inner) {
        // 11.18: the same one again is not a change, and re-subscribing would mint a
        // production out of a recompute that decided nothing. BUT A TRIGGER CAN HAVE
        // LEFT THIS VALUE LOADING OR WITH NOTHING TO SERVE, and nothing but a production
        // of the inner would ever settle it — which an inner with no producer never
        // makes. So the mirror runs again where there is something to settle, and the
        // identity gate is what keeps it waking nobody where the inner did not move.
        if (cell.loading || !cell.servable) mirror(cell, inner)
        return undefined
    }
    // The same source again was checked when it was first adopted, so only a new one is walked.
    for (
        let at: Cell | undefined = inner;
        at !== undefined;
        at = at.adoption?.source
    )
        if (at === cell)
            return new Error(
                'An adoption would close a cycle: these values would adopt each other, so no one of them holds the value. RULEBOOK 11.66.',
            )
    if (standing !== null) standing.stop()
    // 11.17: the adopted value's `identity` is inherited where the outer declared none.
    // Assigned before the first mirror, or the production that mirror makes is gated by
    // the wrong comparison.
    if (cell.identityFn === null) cell.identityFn = inner.identityFn
    simpleShape(cell)
    const stop = watchOver([inner], cell, (): undefined => {
        mirror(cell, inner)
        return undefined
    })
    cell.adoption = { source: inner, stop }
    // 11.60: an adopting value's writes are the adopted value's, reached through a prototype of its
    // own rather than a branch on every value's write path — see `acceptIntoStream` for what such a
    // branch costs under V8 even where nothing takes it.
    Object.setPrototypeOf(cell.callable as object, ADOPTING_PROTOTYPE)
    return undefined
}

// LOSING WHAT THERE WAS TO SERVE, AND BOTH EDGES HEAR IT, whichever way it was lost: a trigger's
// debt settling (7.8), a re-adoption onto nothing (11.16), or a run aborting (11.59). The readers
// hear it through `cascade` and the GUARDS through `probesMoved`. With only the first,
// `{#if outer.ready()}{outer()}{:else}spinner{/if}` re-pointed onto an inner with nothing to serve
// stays on the value branch permanently while the read under it throws, the inner never having
// moved a probe of its own.
function unserve(cell: Cell): void {
    if (!cell.servable) return
    cell.servable = false
    cell.direct = false
    cascade(cell)
    probesMoved(cell)
}

function mirror(cell: Cell, inner: Cell): void {
    // 7.13 through the adoption: the re-settle a re-run of the adopter makes reaches a reload the
    // adopted value owes, rather than finding it unservable and giving up.
    if (inner.owes !== OWES_NOTHING) settleOwed(inner)
    const adopted = inner.stream
    if (adopted !== null) {
        forwardStream(cell, inner, adopted)
        return
    }
    if (cell.stream !== null) stopForwarding(cell)
    if (!inner.servable) {
        // 11.16: the newly adopted has nothing to serve, so neither has this.
        unserve(cell)
        return
    }
    // 11.13 mirrors the production into the outer value, and 11.14 runs the OUTER's own
    // `transform` on the way in — which is `accept`, and is why this does not call
    // `produce` directly.
    accept(cell, heldValue(inner), true)
}

// 11.12 governs what a body HANDS BACK, so a run that hands back something else is no
// longer adopting. Without this the mirror outlives the recompute that ended it: a body
// reading `flag() ? inner : 99` goes on serving 99 until `inner` produces, and then
// serves what `inner` produced — a value its own body never computed. The probes read
// through `adoption` too, so a stale one is also a floor taken from a value nothing reads
// any more.
function dropAdoption(cell: Cell): void {
    const standing = cell.adoption
    if (standing === null) return
    cell.adoption = null
    standing.stop()
    if (cell.stream !== null) stopForwarding(cell)
    Object.setPrototypeOf(
        cell.callable as object,
        cell.simple ? SIMPLE_PROTOTYPE : MEMBER_PROTOTYPE,
    )
}

// 11.15 FOR A STREAM: the adopter takes the adopted value's buffer, ring and ordinals by
// reference and materialises from them on its own reads, through its own gates (11.14, 9.22).
// Mirroring the value instead copied the accumulation once per wake whether or not anything
// read it, and handed a cursor over the adopter whole accumulations where it wanted chunks.
function forwardStream(cell: Cell, inner: Cell, adopted: Stream): void {
    let stream = cell.stream
    if (stream === null) {
        stream = newStream(inner)
        stream.ordinalOffset = cell.ordinal - inner.ringBase
        cell.stream = stream
        cell.plain = false
        cell.bareWrite = false
        simpleShape(cell)
        cell.direct = false
    }
    // The adopted version is this one's: a chunk or a patch of the stream moves both, and a write
    // made on this value is made on the stream (11.60).
    stream.chunks = adopted.chunks
    stream.version = adopted.version
    stream.visible = adopted.visible
    if (adopted.written && adopted.materialisedAt === adopted.version) {
        stream.materialisedAt = stream.version
        stream.written = true
        gateInto(cell, inner.value)
    }
    cell.ring = inner.ring
    cell.ringBase = inner.ringBase + stream.ordinalOffset
    cell.ordinal = inner.ordinal + stream.ordinalOffset
    if (!inner.servable) {
        // 11.16, as for a value: the adopted has nothing to serve, so neither has this.
        unserve(cell)
        return
    }
    // The adopter's OWN load — the body run that handed the stream back — is over. `busy` goes
    // on answering through the adoption (11.19) for as long as the stream is open.
    const moved = settleProbes(cell)
    landChunks(cell)
    cascade(cell)
    if (moved) probesMoved(cell)
}

function stopForwarding(cell: Cell): void {
    cell.stream = null
    cell.plain = cell.expiry === null
    cell.bareWrite = cell.schema === null && cell.transform === null
    simpleShape(cell)
    cell.ring = cell.ringDepth > 0 ? [] : EMPTY_RING
    // The ring is empty and the next production is `ordinal + 1`, at index zero.
    cell.ringBase = cell.ordinal
}

// THE ABORT. A body that reads a value which has not landed throws `NotLanded`, and
// this catches it and returns — the body is ABANDONED, not retried in place. The read
// that threw has already registered this cell as a reader of it (tracking happens
// before the throw), so the source landing is what re-runs the body.
//
// "Throw a sentinel and re-run" was refused once on three grounds. Two are answered
// by the reach starting the work (1.7) — the loads are in flight before the body
// runs, so the abort costs a re-entry rather than a round trip. The third, that
// nothing on a server wakes an abandoned body, is answered by the sink rather than
// by a subscriber.
function run(cell: Cell): void {
    const body = cell.body
    if (body === null) return
    // A body cannot meaningfully re-enter itself, and a cycle in the graph is the case
    // where the cascade would try: `a` reads `b` and `b` reads `a`. Without this the
    // recursion is unbounded and the failure is a stack overflow rather than a value.
    if (cell.running) return
    cell.generation += 1
    cell.state = CLEAN
    cell.running = true
    const reader = cell as unknown as Subscriber
    // No closure and no `withReader` frame: a run allocated one closure per recompute,
    // and a recompute is per write on every derived value in the graph.
    const previous = TRACKING.reader
    TRACKING.reader = reader
    // THE RUN'S CURSOR, spelled out rather than behind a call frame on a path walked once
    // per node per write. Zero is also "has diverged nowhere yet": see `tracking.ts`.
    reader.cursor = 0
    // The probe edge is rebuilt rather than cursored: a guard that stops being taken has
    // to stop waking, and a body reads few probes where it reads many values.
    if (reader.probeSources.length !== 0) detachProbes(reader)
    let produced: unknown
    try {
        // 11.32 — UNDER THE VALUE'S OWN SCOPE, not the ambient one. A drain runs every body a
        // turn's writes woke, and the turn is whichever request scheduled it — so without this a
        // body filed under one request reads the values of another.
        produced = runInScope(cell.scope, body, cell.args)
    } catch (thrown) {
        TRACKING.reader = previous
        if (reader.cursor < reader.sources.length) truncate(reader)
        cell.running = false
        if (thrown instanceof NotLanded) {
            cell.loading = true
            // 2.14: the mark a source's production makes is what finishes this run, and
            // `markReaders` queues it rather than leaving it for a read that may never come.
            cell.aborted = true
            // NOT EVERYTHING IT READS IS READY, so neither is this — 11.59, and the same
            // sentence 11.16 makes for a re-adoption. It stops serving rather than handing
            // back a figure it computed from a source that has since gone away, and that
            // is a move its readers have to hear even though the aborted run minted
            // nothing for a cascade to carry.
            if (cell.servable) unserve(cell)
            else probesMoved(cell)
            return
        }
        refused(cell, thrown)
        return
    }
    TRACKING.reader = previous
    cell.aborted = false
    // A body that read FEWER values than last time leaves a tail nothing reads, and
    // that is the only thing the truncation has to do — so the test is here and the call
    // is the rare arm.
    if (reader.cursor < reader.sources.length) truncate(reader)
    cell.running = false
    // A VALUE THAT WAS ADOPTING AND IS NOT ANY MORE. Behind the `adoption` load so every
    // other recompute pays one field test rather than the brand read below it.
    if (cell.adoption !== null) {
        if (isReactive(produced)) {
            adoptAnswer(cell, produced)
            return
        }
        dropAdoption(cell)
    }
    // 4.16: a body's first answer of `undefined` is an opening, and lands past the pipeline.
    if (produced === undefined && !cell.landed) {
        landOpening(cell)
        return
    }
    // The settled, untransformed recompute is the common shape, and `absorb` -> `accept`
    // -> `produce` is three frames behind it. A recompute runs per write on every
    // derived value in the graph, so the frames are paid per edge.
    //
    // SPELLING `produce` OUT HERE WAS TRIED AND IS NOT WORTH IT: copying the identity
    // gate, the seven stores and the ring into this branch took the recompute from
    // 23.58 ns to 22.42 ns and the chain of twenty from 583 to 563 — 5% and 3% — for
    // twenty-five duplicated lines of the most subtle logic in the file. A second copy
    // of the production rule is the drift every document here is arranged to stop.
    // BOTH GATES, NOT ONE. This arm exists to skip `absorb` -> `accept` -> `produce` for the
    // settled, ungated recompute — and `accept` is where 4.3 runs the schema, so testing
    // only `transform` here routed every body production straight past its own gate
    // (11.47). The gate was written, the tests were written, and this path answered them
    // without ever reaching it.
    const primitive =
        produced === null ||
        (typeof produced !== 'object' && typeof produced !== 'function')
    if (cell.bareWrite && primitive) {
        produce(cell, produced, true)
        return
    }
    // 15.5 — A BODY THAT RETURNS A REFUSAL REFUSES. Past the primitive arm, so a recompute
    // answering a number pays nothing for it, and ahead of the object arm, because a `Failed` is
    // an object with no `then` and that arm would store it as the value. It lands the way a
    // body's throw does above, a refusal being the same observable move whichever way the body
    // said it.
    if (!primitive && isFailed(produced)) {
        refused(cell, produced)
        return
    }
    if (
        cell.bareWrite &&
        typeof (produced as PromiseLike<unknown>).then !== 'function'
    ) {
        produce(cell, produced, true)
        return
    }
    // 11.12 BEFORE `absorb`, and the order is the whole of it: a `Reactive` is thenable
    // (1.4), so absorbing one would settle a live value to a single snapshot — which is
    // the hazard 1.6 names, answered here by adopting instead of storing.
    if (isReactive(produced)) {
        adoptAnswer(cell, produced)
        return
    }
    absorb(cell, produced, true, true)
}

// 11.67 — a body's answer that 11.66 refuses is the body's failure.
function adoptAnswer(cell: Cell, produced: unknown): void {
    const cycle = adopt(cell, (produced as Callable)[CELL])
    if (cycle !== undefined) refused(cell, cycle)
}

// 4.16: AN OPENING `undefined` IS LOADED AND IS NOT A PRODUCTION THROUGH THE PIPELINE. No `schema`
// judges it, no `transform` shapes it, no window holds it and no `store` writes it — it is the value
// being empty, and the first real production is what those are for. It mints no ordinal (6.19).
function landOpening(cell: Cell): void {
    const moved = settleProbes(cell)
    cell.value = undefined
    cell.landed = true
    cell.servable = true
    setDirect(cell, cell.state === CLEAN)
    cascade(cell)
    if (moved) probesMoved(cell)
}

// WHAT STARTS A PRODUCER, for the three callers that start one: construction, `refresh`
// and `invalidate`. A stream is dispatched HERE rather than inside `run`, which a recompute
// walks per node per write — and a stream is never recomputed, having no tracked source to
// be marked by (14.13).
function startProducer(cell: Cell): void {
    const stream = cell.stream
    if (stream === null || stream.source !== null) run(cell)
    else startStream(cell, stream)
}

// The run in flight stops reaching the value. A generator suspended inside an `await` takes the
// request once it reaches a `yield`, and whatever it yields before then is dropped by the run
// test in `pump`.
function stopStream(stream: Stream): void {
    stream.run += 1
    const superseded = stream.iterator
    stream.iterator = null
    if (superseded !== null && typeof superseded.return === 'function')
        superseded.return().then(undefined, () => undefined)
}

function startStream(cell: Cell, stream: Stream): void {
    stopStream(stream)
    const run = stream.run
    beginLoad(cell)
    // UNTRACKED. Calling an async generator function runs none of its body — every read in
    // it happens after an `await`, where 14.13 has it register against nothing — so the
    // reader standing on this stack is not one this body could ever be attributed to.
    const iterator = untracked(
        openStream,
        cell.body as (args: unknown) => AsyncIterable<unknown>,
        cell.args,
    )
    stream.iterator = iterator
    // 11.32 — a generator's body runs inside each `next()`, so the pump is what carries the scope.
    void runInScope(
        cell.scope,
        () => pump(cell, stream, iterator, run),
        undefined,
    )
}

function openStream(
    body: (args: unknown) => AsyncIterable<unknown>,
    args: unknown,
): AsyncIterator<unknown> {
    return body(args)[Symbol.asyncIterator]()
}

async function pump(
    cell: Cell,
    stream: Stream,
    iterator: AsyncIterator<unknown>,
    run: number,
): Promise<void> {
    // 9.21: nothing of this run is served until it says something, so the accumulation
    // being served is the previous run's until the first chunk replaces it.
    let begun = false
    for (;;) {
        let step: IteratorResult<unknown>
        try {
            step = await iterator.next()
        } catch (failed) {
            if (stream.run !== run) return
            stream.iterator = null
            // 2.4: what the stream had already said goes on being served, with the failure
            // standing beside it — and 2.2 where it had said nothing.
            refused(cell, failed)
            return
        }
        if (stream.run !== run) return
        if (step.done === true) break
        if (!begun) {
            begun = true
            beginAccumulation(cell, stream)
        }
        acceptChunk(cell, stream, step.value)
    }
    stream.iterator = null
    // THE CLOSE RELEASES WHAT A WINDOW IS HOLDING. A stream that has finished has nothing left to
    // collapse, and an await resolving here would otherwise be handed the accumulation as the last
    // release left it rather than the whole of it (2.8).
    const cap = cell.cap
    if (cap?.holding) {
        if (cap.timer !== null) clearTimeout(cap.timer)
        cap.timer = null
        cap.holding = false
        releaseChunks(cell, stream)
    }
    const moved = !begun || cell.loading
    if (!begun) {
        // A stream that closed with nothing in it has finished, and what it accumulated is
        // no chunks — a value, where waiting on would be a load that never ends.
        beginAccumulation(cell, stream)
        landChunks(cell)
        cascade(cell)
    }
    cell.loading = false
    // 3.7: `busy` held until the close, and this is the close.
    if (moved) probesMoved(cell)
    // 6.17, AFTER THE CASCADE ABOVE: the entry is what a read would answer with, so it is taken
    // once the last chunk has landed and the value is servable.
    retainRun(cell, stream)
    // 8.9: a stream is written once, at the close, with the accumulation and never a partial.
    if (cell.store !== null) writeStore(cell, cell.store, heldValue(cell))
}

function beginAccumulation(cell: Cell, stream: Stream): void {
    stream.closed = false
    const chunks: unknown[] = []
    stream.chunks = chunks
    stream.visible = 0
    stream.version += 1
    // A cursor holds ordinals, and `ring[i]` carries `ringBase + i + 1` — so the new run's
    // first chunk is the next ordinal, and a cursor from the previous run clamps forward.
    cell.ring = chunks
    cell.ringBase = cell.ordinal
}

// ONE CHUNK IS ONE PRODUCTION, and ungated: an accumulation that grew is a different value
// whatever `identity` says about its last element (9.6's reading, applied per chunk).
function acceptChunk(cell: Cell, stream: Stream, chunk: unknown): void {
    stream.chunks.push(chunk)
    cell.ordinal += 1
    // 3.8: `ready` from the first chunk, and `error` cleared by an accepted production (4.11).
    if (!cell.servable || cell.failure !== undefined) stream.probesOwed = true
    // 5.18: THE WINDOW CAPS THE WAKE, and the chunk is already in the buffer for a cursor.
    if (tellsChunks(cell, cell.cap)) releaseChunks(cell, stream)
}

// What a reader is told of: every chunk landed so far becomes what a read materialises, and the
// wake goes out at most once per task (9.23).
function releaseChunks(cell: Cell, stream: Stream): void {
    stream.visible = stream.chunks.length
    stream.version += 1
    landChunks(cell)
    wakeLater(cell, stream)
}

// THE STREAMS HOLDING A WAKE, and one task drains all of them — never a task per stream.
// The pull is untouched: a read taken before the task runs materialises what has landed
// (12.12), so what waits is only the telling.
const WAKING: Cell[] = []
let wakeQueued = false

function wakeLater(cell: Cell, stream: Stream): void {
    if (stream.waking) return
    stream.waking = true
    WAKING.push(cell)
    if (wakeQueued) return
    wakeQueued = true
    nextTask(wakeStreams)
}

function wakeStreams(): void {
    wakeQueued = false
    // The length is re-read per turn: a mirror the cascade runs can land on another stream.
    for (let index = 0; index < WAKING.length; index += 1) {
        const cell = WAKING[index] as Cell
        const stream = cell.stream as Stream
        stream.waking = false
        const owed = stream.probesOwed
        stream.probesOwed = false
        cascade(cell)
        if (owed) probesMoved(cell)
    }
    WAKING.length = 0
}

// THE NEXT TASK. `setImmediate` where the runtime has one — bun, and so every server — and a
// `MessageChannel` post in a browser, which has none and clamps a nested `setTimeout` to 4 ms.
// The channel is made on first use, so a page that never streams never opens one.
let postTask: ((run: () => void) => void) | null = null

function nextTask(run: () => void): void {
    if (postTask === null) postTask = taskPoster()
    postTask(run)
}

function taskPoster(): (run: () => void) => void {
    if (typeof setImmediate === 'function')
        return (run) => {
            setImmediate(run)
        }
    const channel = new MessageChannel()
    let queued: (() => void) | null = null
    channel.port1.onmessage = (): void => {
        const run = queued
        queued = null
        run?.()
    }
    return (run) => {
        queued = run
        channel.port2.postMessage(null)
    }
}

function landChunks(cell: Cell): void {
    cell.failure = undefined
    cell.landed = true
    cell.servable = true
    cell.direct = false
}

// 9.2 AND 9.22: the read that asks is where the accumulation becomes a `Stored`, through both
// gates, once per chunk count however many reads ask.
function materialise(cell: Cell, stream: Stream): void {
    if (stream.materialisedAt === stream.version || !cell.servable) return
    stream.materialisedAt = stream.version
    stream.written = false
    gateInto(cell, stream.chunks.slice(0, stream.visible))
}

// What a forwarding value's read takes in, through its own gates (11.14, 9.22): a slice of the
// accumulation, or a write standing on the stream it forwards.
// 4.7: the gates run untracked, and this is reached from inside whatever read asked.
function gateInto(cell: Cell, raw: unknown): void {
    untracked(gateThrough, cell, raw)
}

function gateThrough(cell: Cell, raw: unknown): void {
    let checked: unknown = raw
    if (cell.schema !== null) {
        const answer = runSchema(cell.schema, checked)
        if (answer.issues !== null) {
            // 4.9: nothing is stored, so the snapshot before this one goes on serving.
            refused(cell, validationError<Found>(answer.issues))
            return
        }
        checked = answer.value
    }
    const transform = cell.transform
    if (transform !== null) {
        const shaped = transform(checked)
        if (isFailed(shaped)) {
            refused(cell, shaped)
            return
        }
        checked = shaped
    }
    cell.value = checked
}

// What is held, for the paths that hand the value to somebody other than a reader — an
// effect, a waiter, an adoption's mirror.
function heldValue(cell: Cell): unknown {
    const stream = cell.stream
    if (stream !== null) materialise(cell, stream)
    return cell.value
}

// 6.13: THE DROP, AND IT IS THE WHOLE OF WHAT A DEADLINE DOES. The production is
// RELEASED rather than merely stopped being served, and that is the difference between a
// `ttl` that bounds memory and one that only bounds freshness: a body returning a large
// payload holds it until something replaces it, and on a value nothing reads again that
// is the life of the process.
//
// 6.15: `loading` IS NOT SET, because nothing has been started. 6.12 has the producer run
// on the READ that follows, so between the deadline and that read the value is neither
// ready nor busy — which is exactly what those two probes mean, and is why `s.ready`
// needs no clock of its own: it reads `servable`, and this is what moved it.
//
// 6.4: NOTHING IS WOKEN. A wake here would cause the read that runs the producer, and a
// `ttl` would then reload every value on its deadline whether or not anything wanted it —
// which is `s.refresh` (7.4) wearing a different name.
function dropStanding(cell: Cell, expiry: Expiry): void {
    expiry.dropped = true
    cell.value = undefined
    cell.landed = false
    cell.servable = false
    cell.direct = false
}

// 6.9: THE NEAREST DEADLINE THIS VALUE HOLDS — the ring's head where it retains anything,
// the standing production otherwise, and neither where it holds none. A value that has
// nothing left to expire arms nothing, which is what stops the callback below keeping
// every `ttl` value alive for the life of the process: it names its cell.
function armNext(cell: Cell, expiry: Expiry): void {
    if (expiry.timer !== null) return
    let deadline = headDeadline(expiry, standingKept(cell))
    if (standingLive(cell, expiry)) {
        const standing = expiry.at + expiry.ms
        if (standing < deadline) deadline = standing
    }
    if (deadline === Number.POSITIVE_INFINITY) return
    armTimer(expiry, deadline - Date.now(), () => {
        sweepExpiry(cell)
    })
}

// WHETHER THERE IS A PRODUCER TO RUN AGAIN: a body, or a store (8.2), which is somewhere to get the
// value back from. A value with neither holds what the app put there, and a deadline or a trigger
// has nothing to reload it with (6.8, 7.6).
function reloads(cell: Cell): boolean {
    return cell.body !== null || cell.store !== null
}

// RUN THE PRODUCER AGAIN, for a trigger (7.4), a debt a read settles (7.13) and a deadline a read
// follows (6.12). `startProducer` rather than `run`: on a streaming producer the body is the
// generator, and running it as a recompute would store the iterator it hands back (9.20).
function reload(cell: Cell): void {
    if (cell.body !== null) startProducer(cell)
    else rereadStore(cell, cell.store as Persisted)
}

// A LOAD HAS STARTED, and `busy` is the probe it moves (3.7) — a guard that asked has to hear it,
// and nothing a reader can see has moved yet. Called WHERE THE LOAD STARTS — a pending answer taken
// in, a stream opened, a store read that did not answer at once — and nowhere ahead of it. A caller
// that set `loading` on its way in made each of those find it already set and stay silent, so a
// reload a read started was one no `busy` guard ever saw; and a synchronous body that is no load at
// all woke every guard onto a `busy` that was false again by the time it ran.
function beginLoad(cell: Cell): void {
    if (cell.loading) return
    cell.loading = true
    probesMoved(cell)
}

// WHETHER A DEADLINE REACHES THE STANDING PRODUCTION: there is a producer to reload it (6.8), 6.13
// has not already released it, and it is being served — which is what keeps a value whose load is
// in flight from arming against the production that load is replacing.
//
// AND WHAT IS SERVED WAS MINTED, which every producer but a streaming one answers yes to the moment
// it is servable. A stream serves the run it is building (9.2), and that run has minted nothing
// until it closes (6.17) — so a deadline has nothing to measure from and must not drop it.
function standingLive(cell: Cell, expiry: Expiry): boolean {
    if (!reloads(cell) || expiry.dropped || !cell.servable) return false
    const stream = cell.stream
    return stream === null || stream.closed
}

// WHICH RING A DEADLINE REACHES. On a streaming producer the cell's own ring is the chunk buffer
// and its past is the closed runs (6.17), so an expiry trims the view rather than the cell —
// one narrow face, picked here rather than tested at each of the three call sites.
function ringedOf(cell: Cell): Ringed {
    const stream = cell.stream
    return stream === null ? cell : historyView(cell, stream)
}

// 6.8: on a value with no producer a deadline reaches the past productions alone, and the standing
// one — what the app put there — stays in the ring as it stays served.
function standingKept(cell: Cell): number {
    return reloads(cell) ? 0 : 1
}

// 6.9's timer, fired — AND IT MAY BE EARLY. The standing deadline moves forward on every
// production and re-arming per production would be a `setTimeout` per write, which is what
// 6.6 refuses in the ring's shape and costs the same here. So the timer is left where it
// was, and this re-arms against whatever is nearest now. An early fire drops nothing and
// costs one re-arm per window.
function sweepExpiry(cell: Cell): void {
    const expiry = cell.expiry
    if (expiry === null) return
    expiry.timer = null
    if (cell.ringDepth > 0)
        dropExpired(expiry, ringedOf(cell), standingKept(cell))
    if (standingLive(cell, expiry) && Date.now() - expiry.at >= expiry.ms)
        dropStanding(cell, expiry)
    armNext(cell, expiry)
}

// THE READ'S HALF. The timer above is what normally moves the probes, and this is the
// backstop for one that fired late — a clamped background tab, a blocked loop, a `ttl`
// under the clamp. 6.5 and 6.11 are written about the READ rather than about when the
// timer got there.
//
// A VALUE WITH NO BODY REACHES HERE AND TURNS ROUND, one frame per read, and that is
// deliberate: `setDirect` tests one field, and telling one from a body value there would put a
// second load on the path every value in the design walks. A retained value's per-row reader is
// the cursor (2.5), not `s()`. 6.8 is the same sentence from the other side — with no body
// there is nothing to call, so what the app put there stands.
function expire(cell: Cell): void {
    if (!reloads(cell)) return
    const expiry = cell.expiry as Expiry
    if (standingLive(cell, expiry) && Date.now() - expiry.at >= expiry.ms)
        dropStanding(cell, expiry)
    // 6.12: THE PRODUCER RUNS ON THE READ THAT FOLLOWS, and `dropped` is what tells this
    // from an `invalidate` whose load is still in flight. No combination of the cell's own
    // fields separates them — both are unservable with a body — and reading it wrong runs
    // the body again on every read for as long as the load takes.
    if (!expiry.dropped) return
    expiry.dropped = false
    // Work is started NOW, which is the first moment 6.15 stops applying — and `busy` moves where
    // the load actually starts, not here (see `beginLoad`).
    reload(cell)
}

// EVERY REASON `direct` IS FALSE, told apart here rather than on the read. It is the
// pull and the refusal in one frame, and it is correct however the flag got to false —
// which is what lets the flag be conservative.
function readIndirect(cell: Cell): unknown {
    if (cell.owes !== OWES_NOTHING) settleOwed(cell)
    if (cell.state !== CLEAN) resolve(cell)
    // 6.11: THE READ THAT FOLLOWS. Every value carrying an expiry arrives here and no
    // other value does, which is the whole of what `setDirect` buys.
    if (cell.expiry !== null) expire(cell)
    if (cell.stream !== null) materialise(cell, cell.stream)
    if (!cell.servable) {
        // 2.3: a failed producer with nothing landed is the one case holding no value
        // and a refusal that explains the absence.
        const failure = failureOf(cell)
        if (failure !== undefined) throw failure
        throw new NotLanded(cell.callable as object, cell.label)
    }
    return cell.value
}

// Propagation, derived on the read that asks (11.22) rather than held as a
// subscription per source. 11.20: a value is busy where a source it read is busy —
// and the premise is what `busy` MEANS, not which trigger produced it, so a refresh
// over a landed source reports through here even though the body never re-ran.
// Every value that declares no `history` shares this. The field stays monomorphically an
// Array — CLAUDE.md's shape rule — and every site that pushes is already inside a
// `ringDepth > 0` test, so nothing can reach it to mutate. Frozen so that if anything
// ever does, it says so rather than corrupting every other value at once.
const EMPTY_RING = Object.freeze([]) as unknown as unknown[]

// A VISITED STAMP, NOT A STACK GUARD, and the difference is an asymptote. Added before
// the recursion and removed after it, a guard only says a node is on the CURRENT PATH —
// so a shared subgraph is re-walked once per path that reaches it, and a 26-cell DAG
// with 130 edges cost 19,660 edge visits and 4,010 hash operations per probe read.
//
// The stamp MEMOISES, and it is sound for one reason worth stating: within a pass,
// "already visited while the walk is still running" IMPLIES "not busy", because a busy
// node short-circuits the whole walk at its first visit. So a second arrival at a
// stamped node answers false without descending.
//
// This is the exhaustive case rather than the rare one: the walk short-circuits on
// `true`, so the full traversal is the ALL-IDLE graph — the spinner read that renders
// no spinner, every frame.
let PROBE_PASS = 0

function walkBusy(cell: Cell, pass: number): boolean {
    if (cell.loading) return true
    const adoption = cell.adoption
    if (cell.sources.length === 0 && adoption === null) return false
    if (cell.probePass === pass) return false
    cell.probePass = pass
    // 11.19: an adopting value reports busy only where the adopted one does — and the
    // adopted is not in `sources`, because the cursor protocol owns that list and would
    // truncate anything the body did not read on its next run.
    if (adoption !== null && walkBusy(adoption.source, pass)) return true
    const sources = cell.sources
    for (let index = 0; index < sources.length; index += 1)
        if (walkBusy(sources[index] as Cell, pass)) return true
    return false
}

// A VALUE WITH NOTHING UNDER IT ANSWERS FROM ITS OWN FIELD. The walks already test this,
// one frame in — hoisting it costs nothing to the graph case and is the whole of the probe
// for a state, which is what `{#if user.ready()}` reads. Leaving it inside took a leaf
// `ready` from 1.07 ns to 2.05 ns for a pass counter nobody was going to read.
// 3.3: READING A PROBE SUBSCRIBES. Without it the canonical template shape can never come
// back: `{#if s.ready()}{s()}{:else}spinner{/if}` renders the spinner, and in that branch it
// never reads `s()` — so it subscribes to NOTHING, and the value landing wakes nobody. It
// is stuck on the spinner for the life of the page, with the value sitting right there.
//
// ON ITS OWN EDGE, which is 3.3's "that probe alone" and is bought by what the other
// spelling costs the DOM. Subscribing a probe reader through the VALUE edge works and is
// twenty lines lighter — and then a load STARTING wakes every reader of the value, which
// on a fifty-row list is fifty `.data` writes with the same string in them. Measured with
// `harness/measure`: a refresh that changed nothing reported 50 dataWrites, 50 of them
// redundant. That is precisely what 5.2's identity gate exists to stop, and it cannot see
// a wake nobody minted a production for.
function isBusy(cell: Cell): boolean {
    const reader = TRACKING.reader
    if (reader !== null) trackProbe(cell, reader)
    return busyNow(cell)
}

// `busy` WITHOUT SUBSCRIBING, for a caller that is not a reader — `then` asks it and must not
// become a probe edge of whatever body happens to be on the stack.
// 11.51 FOR `error`: the standing refusal is the value's own, or else the one standing on what
// it adopts. Unlike `busy` and `ready` it does not propagate from what a body READ (11.20) —
// a derived value whose source failed has either a figure of its own or its own refusal.
function failureOf(cell: Cell): unknown {
    let at = cell
    while (at.failure === undefined && at.adoption !== null)
        at = at.adoption.source
    return at.failure
}

function busyNow(cell: Cell): boolean {
    if (cell.loading) return true
    if (cell.sources.length === 0 && cell.adoption === null) return false
    PROBE_PASS += 1
    return walkBusy(cell, PROBE_PASS)
}

// THE OTHER HALF OF THE FLOOR, and the quantifiers are not a pair of preferences: `busy`
// asks whether ANYTHING it reads is loading, `ready` whether EVERYTHING it reads has
// something to serve. That is the only pairing under which `busy && !ready` reads as one
// sentence, and it is what makes a value no better than the worst thing it was built from.
//
// WITHOUT IT A DERIVED VALUE OUTRANKED ITS SOURCE: `source.invalidate()` left the source
// reporting `ready` false while the value derived from it reported true and went on
// serving the figure it had computed before — right by its own lights, and a lie about the
// data. Nothing in the output says so, which is why this is a walk and not a field.
//
// The stamp MEMOISES the same way `walkBusy`'s does and is sound for the mirrored reason:
// this walk short-circuits on NOT ready, so a second arrival at a node the walk is still
// inside is a node that has not refused, and answering `true` there is answering what the
// first visit will.
function walkReady(cell: Cell, pass: number): boolean {
    if (!cell.servable) return false
    const adoption = cell.adoption
    if (cell.sources.length === 0 && adoption === null) return true
    if (cell.probePass === pass) return true
    cell.probePass = pass
    if (adoption !== null && !walkReady(adoption.source, pass)) return false
    const sources = cell.sources
    for (let index = 0; index < sources.length; index += 1)
        if (!walkReady(sources[index] as Cell, pass)) return false
    return true
}

function isReady(cell: Cell): boolean {
    const reader = TRACKING.reader
    if (reader !== null) trackProbe(cell, reader)
    return readyNow(cell)
}

function readyNow(cell: Cell): boolean {
    if (!cell.servable) return false
    if (cell.sources.length === 0 && cell.adoption === null) return true
    PROBE_PASS += 1
    return walkReady(cell, PROBE_PASS)
}

// 2.8: SETTLED IS SERVABLE AND NOT BUSY, and it is both halves — `busy` as the probe answers
// it, through what the value read and what it adopted. Resolving on `servable` alone handed a
// caller awaiting a refresh the value the refresh was replacing, and a caller awaiting a stream
// its first chunk; reading the value's own `loading` alone did the same through an adoption.
function settled(cell: Cell): Promise<unknown> {
    // 1.7: awaiting a value is reaching it, so what a read would pull is pulled here too — a reload
    // an invalidate owed, and a recompute a write left marked.
    if (cell.owes !== OWES_NOTHING) settleOwed(cell)
    if (cell.state !== CLEAN) resolve(cell)
    if (cell.servable && !busyNow(cell)) return Promise.resolve(heldValue(cell))
    if (!cell.landed && !busyNow(cell)) {
        const failure = failureOf(cell)
        if (failure !== undefined) return Promise.reject(failure)
    }
    return new Promise((settle, fail) => {
        // THE ONE CELL IT WAITS ON, declared rather than tracked. It was registered outside
        // the tracking protocol, so without this a `CHECK` mark arriving from further
        // upstream would have nothing to resolve against.
        const waiter: Subscriber = newSubscriber([cell], null)
        waiter.notify = (): void => {
            // THE WAITER PULLS. A value built from a source that has just landed is marked and
            // not yet re-run — nothing else reads it — so asking whether it is busy before
            // pulling it answers from the run that aborted, and the await never settles.
            if (cell.state !== CLEAN) resolve(cell)
            if (busyNow(cell)) return
            if (cell.servable) {
                waiter.alive = false
                dropProbeReader(cell, waiter)
                settle(heldValue(cell))
                return
            }
            if (cell.landed) return
            const failure = failureOf(cell)
            if (failure !== undefined) {
                waiter.alive = false
                dropProbeReader(cell, waiter)
                fail(failure)
            }
        }
        // ON THE PROBE EDGE, because what it waits for is a probe: every way to settled moves
        // `busy` or `ready` here or upstream, and `markProbes` carries an upstream move down
        // the value and adoption edges — where a stream's close mints nothing a value reader
        // would be woken by.
        cell.probeReaders.push(waiter)
    })
}

// 12.9: `s.watch` IS `watch` NARROWED TO THIS VALUE, and now structurally rather than by
// matching its policy clause for clause. 12.3 is the general form — sources given rather
// than discovered — and one source given is what `s.watch` means. What was here before was
// a second copy of the subscriber, the disposer, the re-entrancy guard and 12.8, which is
// exactly the divergence 12.9 forbids: the copy had no `catch` at all, so a throwing effect
// re-ran into the same throw on every write where `watch` stops.
//
// The value is handed over rather than read, so the effect never reaches the tracked path
// and never throws `NotLanded` from this source.
function watchCell(
    cell: Cell,
    // biome-ignore lint/suspicious/noConfusingVoidType: `void` is an EFFECT'S RETURN POSITION and is load-bearing. `undefined` there refuses the ordinary effect — a block body that returns nothing infers `void`, which is not assignable to `undefined` — so the rule's own fix would reject every caller that does not return a disposer.
    effect: (value: unknown) => void | (() => void),
): () => void {
    return watchOver([cell], null, () => {
        // 2.2 holds here as a SKIP rather than a throw: an effect has nothing to be handed
        // until something has landed, and its turn comes when it does.
        if (!cell.servable) return undefined
        return effect(heldValue(cell))
    })
}

function patchCell(cell: Cell, mutate: (value: unknown) => void): void {
    // 2.2: there is nothing to mutate where nothing has landed, and handing the callback
    // `undefined` failed inside the app's own code instead.
    if (!cell.landed) throw new NotLanded(cell.callable as object, cell.label)
    const stream = cell.stream
    if (stream === null) {
        const cap = cell.cap
        // THE HEAD IS THE LAST PRODUCTION MINTED, which a window may be holding apart from the one
        // served: patching the served one overwrote the held production with it, and the write
        // the window held was never seen.
        const head = cap?.holding && cell.body === null ? cap.held : cell.value
        recordWrites(head, mutate, PATCH_SINKS.get(cell))
        // 5.7: REPLACES THE HEAD PRODUCTION RATHER THAN APPENDING ONE, and that is why no
        // sequence number is minted here. The head is the object the callback just mutated, and
        // the ring already holds that same reference — so retention needs no write and the
        // ordinal must not move.
        //
        // IT USED TO MOVE, and the ordinal is what a cursor holds its place by: `ring[i]` carries
        // ordinal `ringBase + i + 1`, so a bump with no push put the two out of step and the next
        // turn read one past the end of the ring and handed over `undefined`. The wake was never
        // the ordinal's doing — it is the cascade's.
        //
        // 5.24 — AND THE CASCADE IS WHAT A WINDOW CAPS. The object has already changed, so what is
        // held is the wake alone: readers are told once per window, and `busy` stands meanwhile
        // (5.16). A body's cap caps its runs instead (5.12), so a patch there wakes as before.
        //
        // 8.8 AS `serve` READS IT: a patch the window held is written by the release that serves
        // it, so a run of patches in one window is one write rather than one per patch (5.12).
        if (cap === null || cell.body !== null || wakes(cell, cap, head)) {
            cascade(cell)
            if (cell.store !== null) persist(cell, cell.store, cell.value)
        }
        return
    }
    // 9.27: the accumulation itself, so the next chunk lands after the change rather than
    // rebuilding a snapshot from chunks the patch never saw.
    recordWrites(stream.chunks, mutate, PATCH_SINKS.get(cell))
    stream.version += 1
    // 5.24, as for a chunk (5.18): the window's close is what tells the readers.
    if (tellsChunks(cell, cell.cap)) cascade(cell)
}

// WHAT AN INVALIDATE LEAVES BEHIND, and it is a debt rather than a mark. The mark walk's states
// are the wrong tool: a node marked `CHECK` or `DIRTY` without its effects queued is one a later
// write's walk stops at — `state >= wanted` — and the effects below it are never woken for a
// change that really happened. So nothing in the graph's state moves; the invalidated value OWES
// A RELOAD, the values built from it OWE A LOOK ABOVE, and none of them is directly servable, so
// the read that reaches any of them goes a frame in and settles the debt first (7.12, 7.13).
const OWES_NOTHING: number = 0
const OWES_ABOVE: number = 1
const OWES_RELOAD: number = 2

// 11.52 IS EVERY TRIGGER AND EVERY ADOPTER, and the chain is walked rather than recursed
// into: the reach into `adoption.source` sat PAST the "no producer" return, so an adoption made by
// `outer.set(inner)` (11.62) — which leaves `body` null — swallowed both triggers whole.
//
// 13.6 is what the "no producer" arm is for: an entry with nothing to reload is skipped, and what
// it ADOPTS still has to be reached.
function eachAdopted(cell: Cell, visit: (cell: Cell) => void): void {
    let at: Cell = cell
    for (;;) {
        visit(at)
        // 11.52: the data is behind whatever the body handed back, not in the body itself
        // — AFTER the run, so the reach is to what is adopted now rather than what was.
        const adoption = at.adoption
        if (adoption === null) return
        at = adoption.source
    }
}

function refreshOne(cell: Cell): void {
    // 7.6: inert on a value with no producer. 8.2 makes a store one, so a refresh re-reads it —
    // another tab may have written.
    if (!reloads(cell)) return
    // 5.25 — A WINDOW HOLDS A REFRESH AS IT HOLDS A PRODUCTION: a throttle lets the first through
    // and opens, a debounce holds every one and is pushed back by each, and what a window held is
    // one reload when it closes. Three refreshes in a row were three loads, two of them superseded.
    const cap = cell.cap
    if (cap !== null && windowHolds(cell, cap)) {
        cap.reloading = true
        return
    }
    reloadNow(cell)
}

function reloadNow(cell: Cell): void {
    // A refresh IS the reload an invalidate owed, so the read after it must not run a second.
    if (cell.owes === OWES_RELOAD) reloadOwed(cell)
    else reload(cell)
}

// 7.8: THE HELD VALUE WAS MARKED WRONG, so the reload that settles the mark is not served over —
// by a refresh or by the read that follows (7.13) alike. Unserved AHEAD of the reload, and the
// order is load-bearing: re-adopting the same value re-mirrors only where the adopter is not
// serving (11.18), and that mirror is what reaches a reload the adopted value owes. What it costs
// is a reload answering at once with the value it held: its readers were woken by the unserve, and
// read the same value again.
function reloadOwed(cell: Cell): void {
    cell.owes = OWES_NOTHING
    unserve(cell)
    reload(cell)
}

// 7.3, 7.12, 7.14 AND 7.17: A MARK, NOT A LOAD, AND NOT A MOVE. Nothing runs, nothing is sent, and
// nothing a reader can see changes — the value goes on being served and `ready` stays true — so no
// reader wakes. The mark is a debt the next read settles, and THAT read is where the value stops
// being served (7.8). Making it unservable here instead woke a `{#if s.ready()}` guard onto a branch
// that never reads the value again, and nothing was ever left to run the producer.
function invalidateOne(cell: Cell): void {
    // 7.6 — sent on to the browsers following it whether or not there is a producer to mark.
    const followed = FOLLOWED.get(cell)
    if (followed !== undefined) for (const sendOn of followed) sendOn()
    if (!reloads(cell)) return
    // Not directly servable, so the next read goes a frame in and settles the debt.
    cell.direct = false
    // 7.15: work already in flight was started from what this says is wrong. A load's answer
    // lands nowhere once `generation` has moved; a stream is stopped outright. `busy` goes false
    // with no wake (7.14, 7.16) — a guard still showing a load reads the truth on its next render.
    cell.generation += 1
    cell.loading = false
    const stream = cell.stream
    if (stream !== null && stream.source === null) stopStream(stream)
    cell.owes = OWES_RELOAD
    owedBelow(cell)
}

// Every value built from this one — read from it, or adopting it — goes a frame in on its next
// read, which is where 7.13's pull happens. A value already owing something has had its own
// downstream flagged, so the walk stops there.
function owedBelow(cell: Cell): void {
    const readers = cell.readers
    for (let index = 0; index < readers.length; index += 1) {
        const reader = readers[index] as Subscriber
        const below = (reader.isEffect
            ? reader.adopter
            : reader) as unknown as Cell | null
        if (below === null) continue
        below.direct = false
        if (below.owes !== OWES_NOTHING) continue
        below.owes = OWES_ABOVE
        owedBelow(below)
    }
}

// THE READ SETTLES THE DEBT. A value owing a reload runs its producer; one owing a look above
// reloads whatever above it owes one, and the cascade from what that reload mints marks it the
// ordinary way — so a reload that lands the same value leaves it serving what it held.
function settleOwed(cell: Cell): void {
    if (cell.owes === OWES_RELOAD) {
        reloadOwed(cell)
        return
    }
    cell.owes = OWES_NOTHING
    pullAbove(cell)
    // Nothing above it changed what it computed, so it is servable straight again.
    if (cell.state === CLEAN) setDirect(cell, cell.servable)
}

function pullAbove(cell: Cell): void {
    const sources = cell.sources
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index] as Cell
        if (source.owes !== OWES_NOTHING) settleOwed(source)
    }
    const adoption = cell.adoption
    if (adoption !== null && adoption.source.owes !== OWES_NOTHING)
        settleOwed(adoption.source)
}

// 9.5: a refusal comes back to the caller, and only a refusal — an accepted write is `void`,
// whatever ordinal `accept` minted for it. Behind its own frame so the settled, ungated
// write above it stays small enough to be inlined into whatever loop calls `set`.
function setThroughGates(cell: Cell, value: unknown): unknown {
    // 11.62: A `Reactive` WRITTEN IS ADOPTED, never stored — the same sentence 11.12 makes about
    // one a body hands back, and the brand is read before `then` for the same reason (1.6). It is
    // off the common write path rather than in front of it: a settled primitive never reaches this
    // frame at all, and what does is a thenable or a callable.
    if (isReactive(value)) {
        // 11.67 — a write that would close a cycle throws, as misuse rather than a refusal of data.
        const cycle = adopt(cell, (value as unknown as Callable)[CELL])
        if (cycle !== undefined) throw cycle
        return undefined
    }
    if (!isThenable(value)) {
        const answer = accept(cell, value, true)
        return typeof answer === 'number' ? undefined : answer
    }
    absorb(cell, value, true, false)
    return undefined
}

// 5.20 AND 5.22: AN ENTRY A WINDOW IS HOLDING BACK is busy with nothing to serve, and starting it is
// the window's call. Starting runs the producer the reach would have run.
export function startDeferred(value: unknown): void {
    startProducer((value as Callable)[CELL])
}

// 5.21: an entry the window superseded before it started. Nothing is in flight for it any more,
// and a reader still holding it hears that.
export function abandonDeferred(value: unknown): void {
    const cell = (value as Callable)[CELL]
    if (!cell.loading) return
    cell.loading = false
    probesMoved(cell)
}

// ── `store` ──────────────────────────────────────────────────────────────────────────────

// 8.15: a `get` that throws cannot read the value, and that is a miss — warned, because a store
// that can never be read is one an app wants to hear about.
function readStore(cell: Cell, persisted: Persisted): unknown {
    try {
        return persisted.store.get()
    } catch (failed) {
        warnStore(
            cell,
            'could not be read, and is taken as a miss (8.15)',
            failed,
        )
        return undefined
    }
}

// 8.12 SAYS `onError` TOO, and there is no `onError` yet. The warning is under the namespace the
// clause names.
const STORE_LOG = namedLogger('abide:reactive')

function warnStore(cell: Cell, what: string, failed: unknown): void {
    STORE_LOG.warning(`${cell.label}: a store ${what}.`, failed)
}

// 8.4: A SYNCHRONOUS `get` IS NOT A LOAD — the value is there at construction and nothing is
// pending. An unsettled one is a load like any other, and a write made while it is out supersedes
// it the way a write supersedes any load: `generation` moves, and the answer lands nowhere.
function restoreFirst(
    cell: Cell,
    persisted: Persisted,
    initial: unknown,
): void {
    const answer = readStore(cell, persisted)
    if (!isThenable(answer)) {
        settleRestore(cell, persisted, answer, initial)
        return
    }
    cell.loading = true
    const generation = cell.generation
    answer.then(
        (value) => {
            if (cell.generation === generation)
                settleRestore(cell, persisted, value, initial)
        },
        (failed: unknown) => {
            if (cell.generation !== generation) return
            warnStore(
                cell,
                'could not be read, and is taken as a miss (8.15)',
                failed,
            )
            settleRestore(cell, persisted, undefined, initial)
        },
    )
}

function settleRestore(
    cell: Cell,
    persisted: Persisted,
    value: unknown,
    initial: unknown,
): void {
    if (value !== undefined) {
        restore(cell, persisted, value)
        return
    }
    // A MISS IS THE VALUE WITHOUT A STORE: the body runs, or the initial value lands (8.3).
    if (cell.body !== null) startProducer(cell)
    else if (initial === undefined) landOpening(cell)
    else if (initial !== NO_INITIAL) absorb(cell, initial, true, false)
    else if (cell.loading) {
        cell.loading = false
        probesMoved(cell)
    }
}

// 8.5: A RESTORE IS NOT A WRITE. It mints the production straight — no `schema`, no `transform`,
// those gating what goes in and a restore being what was already stored — and 8.8 does not write
// it back.
function restore(cell: Cell, persisted: Persisted, value: unknown): void {
    persisted.restoring = true
    try {
        const stream = cell.stream
        if (stream === null) produce(cell, value, true)
        else restoreStream(cell, stream, value as unknown[])
    } finally {
        persisted.restoring = false
    }
}

// 8.6 AND 8.7: the ring is seeded with the accumulation, and the stream reads as finished — ready,
// and not busy — with its body never started.
function restoreStream(cell: Cell, stream: Stream, chunks: unknown[]): void {
    beginAccumulation(cell, stream)
    for (let index = 0; index < chunks.length; index += 1) {
        stream.chunks.push(chunks[index])
        cell.ordinal += 1
    }
    stream.visible = stream.chunks.length
    stream.version += 1
    const moved = settleProbes(cell)
    landChunks(cell)
    cascade(cell)
    if (moved) probesMoved(cell)
    // 8.7 SAYS THE BODY NEVER STARTS, AND `pump` IS WHAT REACHES `retainRun` — so the
    // restored accumulation is entered as a closed run here or nothing ever does it.
    // Without this `standingLive` answers false for the life of the value, which takes
    // the `ttl` out of `expire` and `sweepExpiry` silently — it never drops and never
    // re-reads the store — and leaves `s.history()` empty over 8.6's seeded ring.
    retainRun(cell, stream)
}

// A refresh, an invalidate or an expiry of a value whose only producer is its store. A hit
// restores; a miss leaves what is held being served, there being nothing newer to replace it with.
//
// 8.18: A WRITE THE APP HAS MADE IS THE NEWEST TRUTH, so while one is unconfirmed the store is not
// asked at all and the written value stands in its place. Asking took the value BACKWARDS and left
// it there: `s.set(99)` over a store still holding 1 leaves a `set` in flight, a `refresh` in the
// same turn read 1 and produced it, and the queued write then landed 99 in the store — the cell
// serving 1 and the store holding 99 for the life of the value, with `restoring` stopping the
// reverted value from being written back and no probe moving to say so.
function rereadStore(cell: Cell, persisted: Persisted): void {
    if (persisted.writing) {
        restore(cell, persisted, persisted.unconfirmed)
        return
    }
    const answer = readStore(cell, persisted)
    if (!isThenable(answer)) {
        settleReread(cell, persisted, answer)
        return
    }
    beginLoad(cell)
    const generation = cell.generation
    answer.then(
        (value) => {
            if (cell.generation !== generation) return
            settleReread(cell, persisted, value)
        },
        (failed: unknown) => {
            if (cell.generation !== generation) return
            warnStore(
                cell,
                'could not be read, and is taken as a miss (8.15)',
                failed,
            )
            settleReread(cell, persisted, undefined)
        },
    )
}

// 8.18 IS READ ON THE WAY OUT AS WELL AS ON THE WAY IN. A write made while the `get` was in flight
// is newer than whatever that `get` answers, hit or miss, and `generation` does not separate them
// — a write moves it only where it is a LOAD (4.2), and a settled `s.set` never touches it.
function settleReread(cell: Cell, persisted: Persisted, value: unknown): void {
    if (persisted.writing) restore(cell, persisted, persisted.unconfirmed)
    else if (value !== undefined) restore(cell, persisted, value)
    else settleMiss(cell)
}

function settleMiss(cell: Cell): void {
    // 8.19: NOTHING LEFT TO SERVE. The miss reached a value that holds nothing — an expiry
    // released the standing production (6.13) and the re-read 6.12 owes it came back empty, and
    // there is no body to fall through to on a value whose only producer is its store. Left as a
    // miss it read as `NotLanded` with all three probes silent for the life of the value, and
    // `expire` returned at `dropped` on every later read, so nothing ever asked again.
    if (!cell.landed) {
        refused(
            cell,
            new Error(
                `${cell.label}: its store answered no value and nothing is held (RULEBOOK 8.19).`,
            ),
        )
        return
    }
    const wasServable = cell.servable
    const wasLoading = cell.loading
    cell.servable = true
    cell.loading = false
    setDirect(cell, cell.state === CLEAN)
    if (cell.servable !== wasServable) cascade(cell)
    if (wasLoading || cell.servable !== wasServable) probesMoved(cell)
}

// A restore is what was just read, and a stream is written at its close (8.9) — neither is
// persisted from here.
function persist(cell: Cell, persisted: Persisted, value: unknown): void {
    if (persisted.restoring || cell.stream !== null) return
    writeStore(cell, persisted, value)
}

function writeStore(cell: Cell, persisted: Persisted, value: unknown): void {
    persisted.unconfirmed = value
    if (persisted.writing) {
        persisted.pending = true
        return
    }
    persisted.writing = true
    sendStore(cell, persisted, value)
}

// 8.11: the write never blocks a reader — the value is already held, and `set` is only how it
// leaves. 8.12: a failed write warns and leaves the store attached, so the next is written.
function sendStore(cell: Cell, persisted: Persisted, value: unknown): void {
    let sent: unknown
    try {
        sent = persisted.store.set(value, { ttl: persisted.ttl })
    } catch (failed) {
        warnStore(
            cell,
            'write failed, and the store stays attached (8.12)',
            failed,
        )
        sent = undefined
    }
    if (!isThenable(sent)) {
        storeWritten(cell, persisted)
        return
    }
    sent.then(
        () => {
            storeWritten(cell, persisted)
        },
        (failed: unknown) => {
            warnStore(
                cell,
                'write failed, and the store stays attached (8.12)',
                failed,
            )
            storeWritten(cell, persisted)
        },
    )
}

function storeWritten(cell: Cell, persisted: Persisted): void {
    if (!persisted.pending) {
        persisted.writing = false
        persisted.unconfirmed = undefined
        return
    }
    // `unconfirmed` IS ALREADY THE ONE TO SEND — 8.10 coalesces latest-wins, so every write made
    // while this one was out overwrote it, and the send below is the newest of them.
    persisted.pending = false
    sendStore(cell, persisted, persisted.unconfirmed)
}

// ── Selections over `tags` ─────────────────────────────────────────────────────────────
//
// THE INDEX HOLDS VALUES WEAKLY. A tag is a way to find a value, never a reason to keep one, and a
// strong index would hold every tagged value a page ever made for the life of the process. A
// collected value is pruned from its sets by the next sweep that finds it gone.
const TAGGED = new Map<string, Set<WeakRef<Cell>>>()

// 13.3 AND 13.9: ONE SIGNAL PER SELECTION, keyed by its canonical tags. A guard over a selection
// subscribes to this, never to each entry — the probe edge `trackProbe` makes, from a node that
// is nothing but that edge.
type Signal = { readers: Subscriber[]; probeReaders: Subscriber[] }
const SIGNALS = new Map<string, Signal>()
const SIGNALS_BY_TAG = new Map<string, Signal[]>()

function tagCell(cell: Cell): void {
    const ref = new WeakRef(cell)
    for (const tag of cell.tags as string[]) {
        let carrying = TAGGED.get(tag)
        if (carrying === undefined) {
            carrying = new Set()
            TAGGED.set(tag, carrying)
        }
        carrying.add(ref)
    }
}

// What an eviction calls: an entry out of its `Keyed` is out of every selection with it, rather
// than reachable by a sweep until a collection happens to run.
export function untag(value: unknown): void {
    const cell = (value as Callable)[CELL]
    if (cell.tags === null) return
    for (const tag of cell.tags) {
        const carrying = TAGGED.get(tag)
        if (carrying === undefined) continue
        for (const ref of carrying)
            if (ref.deref() === cell) carrying.delete(ref)
        if (carrying.size === 0) TAGGED.delete(tag)
    }
}

// 13.8 — A TAG IS SCOPE-BOUNDED, so a selection inside one request never reaches the values another
// request filed under the same tag. 13.13 — a `global` value is in every scope, so every selection
// reaches it. In a browser every cell's scope is `undefined`, and so is this.
function carrying(tags: string[]): Cell[] {
    const found = new Set<Cell>()
    const scope = currentScope()
    for (const tag of tags) {
        const refs = TAGGED.get(tag)
        if (refs === undefined) continue
        for (const ref of refs) {
            const cell = ref.deref()
            if (cell === undefined) refs.delete(ref)
            else if (cell.scope === scope || cell.global) found.add(cell)
        }
    }
    return [...found]
}

function trackSignal(tags: string[]): void {
    const reader = TRACKING.reader
    if (reader === null) return
    const key = JSON.stringify([...new Set(tags)].sort())
    let signal = SIGNALS.get(key)
    if (signal === undefined) {
        signal = { readers: [], probeReaders: [] }
        SIGNALS.set(key, signal)
        for (const tag of tags) {
            const signals = SIGNALS_BY_TAG.get(tag)
            if (signals === undefined) SIGNALS_BY_TAG.set(tag, [signal])
            else signals.push(signal)
        }
    }
    trackProbe(signal as unknown as Tracked, reader)
}

function markSignals(tags: string[]): void {
    for (const tag of tags) {
        const signals = SIGNALS_BY_TAG.get(tag)
        if (signals === undefined) continue
        for (const signal of signals) markAsked(signal.probeReaders)
    }
}

export function busyOverTags(tags: string[]): boolean {
    trackSignal(tags)
    for (const cell of carrying(tags)) if (busyNow(cell)) return true
    return false
}

export function readyOverTags(tags: string[]): boolean {
    trackSignal(tags)
    for (const cell of carrying(tags)) if (!readyNow(cell)) return false
    return true
}

export function invalidateOverTags(tags: string[]): void {
    for (const cell of carrying(tags)) eachAdopted(cell, invalidateOne)
}

// 13.7: RELOADED WHERE SOMETHING READS IT, MARKED WHERE NOTHING DOES. A mark is the recompute a
// write would have owed it — `DIRTY` and not directly servable — so the next read pulls the reload
// and until then nothing is requested. A stream is refreshed rather than marked: a pull runs a
// BODY, and a stream's body is a generator that only `startStream` knows how to run.
export function refreshOverTags(tags: string[]): void {
    for (const cell of carrying(tags)) {
        if (
            cell.readers.length !== 0 ||
            cell.probeReaders.length !== 0 ||
            cell.stream !== null
        )
            eachAdopted(cell, refreshOne)
        else if (cell.body !== null) {
            cell.state = DIRTY
            cell.direct = false
        }
    }
}

const MEMBERS = {
    peek(this: Callable): unknown {
        const cell = this[CELL]
        // PULLS, like a read. Under push-pull a write leaves every derived value it
        // reached unrun, so a `peek` that only read the field would answer with the
        // value the last read left behind — 2.2 moved the ABSENCE here, not staleness.
        if (cell.owes !== OWES_NOTHING) settleOwed(cell)
        if (cell.state !== CLEAN) resolve(cell)
        // A `peek` IS A READ by the rulebook's own term, so 6.5, 6.11 and 6.12 reach it
        // the same way. What it does not join is the FLOW (2.11) — an expiry is not a
        // subscription, and a `peek` that went on serving a production `s()` had already
        // dropped would be two answers to what is held.
        if (cell.expiry !== null) expire(cell)
        if (!cell.servable) return undefined
        return heldValue(cell)
    },
    busy(this: Callable): boolean {
        return isBusy(this[CELL])
    },
    ready(this: Callable): boolean {
        return isReady(this[CELL])
    },
    error(this: Callable): unknown {
        const cell = this[CELL]
        // 3.3 ON THE THIRD PROBE. `error` is a probe by the rulebook's own term, so a body
        // reading it subscribes the same way `busy` and `ready` do — without this edge
        // `{#if s.error()}` reads `undefined` once and nothing wakes it when a load fails,
        // because a refusal marks the VALUE readers and this body never read the value.
        const reader = TRACKING.reader
        if (reader !== null) trackProbe(cell, reader)
        return failureOf(cell)
    },
    // THE ONE MEMBER THAT READS NO CELL, so it is the shared function itself — `Rpc.isError` and a
    // socket's are the same one. Its first parameter is the error, as the member's is.
    isError: isFailedNamed,
    set(this: Callable, value: unknown): unknown {
        const cell = this[CELL]
        cell.generation += 1
        // The settled, untransformed write is the overwhelming common shape, and the
        // general path is two call frames and a thenable probe behind it. Inlined here
        // rather than behind `isThenable` so a primitive write tests two types.
        // The same pair as the recompute arm above, and for the same reason: a `set` that
        // skipped `accept` skipped 4.3 with it.
        if (
            cell.bareWrite &&
            (value === null ||
                (typeof value !== 'object' && typeof value !== 'function') ||
                typeof (value as PromiseLike<unknown>).then !== 'function')
        ) {
            produce(cell, value, true)
            return undefined
        }
        return setThroughGates(cell, value)
    },
    publish(this: Callable, value: unknown): unknown {
        const cell = this[CELL]
        cell.generation += 1
        if (!isThenable(value)) return accept(cell, value, false)
        absorb(cell, value, false, false)
        return cell.ordinal
    },
    patch(this: Callable, mutate: (value: unknown) => void): void {
        patchCell(this[CELL], mutate)
    },
    refresh(this: Callable): void {
        eachAdopted(this[CELL], refreshOne)
    },
    invalidate(this: Callable): void {
        eachAdopted(this[CELL], invalidateOne)
    },
    watch(
        this: Callable,
        // biome-ignore lint/suspicious/noConfusingVoidType: `void` is an EFFECT'S RETURN POSITION and is load-bearing. `undefined` there refuses the ordinary effect — a block body that returns nothing infers `void`, which is not assignable to `undefined` — so the rule's own fix would reject every caller that does not return a disposer.
        effect: (value: unknown) => void | (() => void),
    ): () => void {
        return watchCell(this[CELL], effect)
    },
    history(this: Callable, replay?: number): History<unknown> {
        const cell = pastOf(this)
        // 6.17: a streaming producer's past is its CLOSED runs, which is a different ring from
        // the chunk buffer `cell` carries — see `historyView`. Everything below is the same
        // arithmetic over whichever of the two the value has.
        const source: Retained =
            cell.stream !== null ? historyView(cell, cell.stream) : cell
        // 2.6: replay DEPTH alone, bounded above by what is retained.
        const held = retained(source)
        const depth =
            replay === undefined || replay > held
                ? held
                : replay < 0
                  ? 0
                  : replay
        return historyFrom(source, source.ordinal - depth)
    },
    [Symbol.asyncIterator](this: Callable): AsyncIterator<unknown> {
        const cell = this[CELL]
        // 2.7: "the production in flight, from its start". Starting one ordinal back is
        // what includes it rather than skipping to whatever comes next — and clamped at
        // zero, where a value nothing has produced into must WAIT rather than hand over
        // the `undefined` it is holding.
        // A STREAM'S PRODUCTION IN FLIGHT IS THE STREAM, so its start is the run's first
        // chunk rather than the latest one.
        const from =
            cell.stream !== null
                ? cell.ringBase
                : cell.ordinal > 0
                  ? cell.ordinal - 1
                  : 0
        return historyFrom(cell, from)[Symbol.asyncIterator]()
    },
    // biome-ignore lint/suspicious/noThenProperty: RULEBOOK 1.4 — a `Reactive` MUST be thenable, which is what this rule warns about. Banning it buys a discrimination rather than a semantics, and 16.4's in-process `Rpc` arm is what that discrimination would have cost. 1.6 is the guard that makes thenability safe — the brand is read before `then`.
    then(
        this: Callable,
        onSettled?: (value: unknown) => unknown,
        onFailed?: (error: unknown) => unknown,
    ): Promise<unknown> {
        return settled(this[CELL]).then(onSettled, onFailed)
    },
    catch(
        this: Callable,
        onFailed: (error: unknown) => unknown,
    ): Promise<unknown> {
        return settled(this[CELL]).catch(onFailed)
    },
    finally(this: Callable, onSettled: () => void): Promise<unknown> {
        return settled(this[CELL]).finally(onSettled)
    },
}

// THE CELL A READER OF `value`'S PAST IS HANDED, and the one way to it: `s.history` and a socket
// subscription (18.13) both come through here, so neither replays what the other would not.
//
// 9.15: an adopting value's past is the adopted value's, and an adoption of an adoption goes on
// down. Stopping at one level answered from the MIDDLE value's standing production, which retains
// nothing of its own: a two-deep chain over a ring of ten reported one entry.
//
// 6.5, AND THIS IS WHERE IT BITES. A replay is the only way to reach a retained production (2.5), so
// sweeping here is what stops one past its life being handed back — 6.9's timer is the common path
// and this is the backstop for a fire that came late. Before any cursor exists, so 6.7 is untouched:
// what must not observe an expiry is a LIVE cursor.
export function pastOf(value: unknown): Cell {
    const cell = adoptedCellOf(value)
    if (cell.expiry !== null && cell.ringDepth > 0)
        dropExpired(cell.expiry, ringedOf(cell), standingKept(cell))
    return cell
}

// 21.8 — WHEN THE PRODUCTION A VALUE IS SERVING STOPS BEING SERVABLE, as a wall-clock time: its
// own `ttl` from when it was minted (6.11), or its entry's from when the entry last produced
// (11.46), through whatever it adopts. Infinity where neither bounds it.
export function deadlineOf(value: unknown): number {
    const cell = adoptedCellOf(value)
    if (cell.expiry !== null) return cell.expiry.at + cell.expiry.ms
    const entry = ENTRY_LIVES.get(cell)
    return entry === undefined ? Number.POSITIVE_INFINITY : entry.at + entry.ms
}

// 16.53 — WHICH LOAD A VALUE HAS IN FLIGHT, as the generation that started it, or `undefined` where
// none is. Read off the cell rather than through `busy`, which is a probe and would subscribe the
// caller that asked (3.3).
export function loadOf(value: unknown): number | undefined {
    const cell = (value as Callable)[CELL]
    return cell.loading ? cell.generation : undefined
}

// 16.54 — THE LOAD IN FLIGHT, ENDED WHERE IT STANDS. The generation moves so a settle arriving after
// is the stale one `absorb` already drops, a stream stops reaching the value, and the value refuses
// with `failure` — which leaves what it held being served (2.4), a stream's chunks so far included.
export function abandonLoad(value: unknown, failure: unknown): void {
    const cell = (value as Callable)[CELL]
    if (!cell.loading) return
    cell.generation += 1
    if (cell.stream !== null) stopStream(cell.stream)
    refused(cell, failure)
}

// A streaming producer's own `Reactive` — a handler declared as an async generator (9.20).
export function isStreaming(value: unknown): boolean {
    if (!isReactive(value)) return false
    const stream = (value as Partial<Callable>)[CELL]?.stream
    return stream !== null && stream !== undefined
}

// 16.33 — THE CHUNKS A STREAMING VALUE HAS TOLD ITS READERS OF PAST `from`, for a writer sending each
// once. Ungated they are read out of the accumulation in place, to `visible` rather than its length
// (5.19): a read materialises a copy of the whole of it (9.2), which for a writer woken per chunk is
// n²/2 elements copied to send n. A schema or a transform has to see the whole accumulation (9.22),
// so a gated value answers from what a read would.
export function* chunksFrom(value: unknown, from: number): Generator<unknown> {
    const cell = (value as Callable)[CELL]
    if (cell.schema === null && cell.transform === null) {
        const stream = cell.stream as Stream
        for (let index = from; index < stream.visible; index += 1)
            yield stream.chunks[index]
        return
    }
    const held = MEMBERS.peek.call(value as Callable)
    if (Array.isArray(held))
        for (let index = from; index < held.length; index += 1)
            yield held[index]
}

function adoptedCellOf(value: unknown): Cell {
    let cell = (value as Callable)[CELL]
    while (cell.adoption !== null) cell = cell.adoption.source
    return cell
}

// What a value filed outside every scope forwards (`scoped.ts`): read off the record, so a member
// added here is forwarded without a second list to keep in step.
export const MEMBER_KEYS: readonly PropertyKey[] = Reflect.ownKeys(MEMBERS)

// ONE PROTOTYPE, NOT FOURTEEN COPIES PER VALUE. `Object.assign(self, MEMBERS)` was 437
// of the 501 ns a value cost to construct under bun's JSC and 855 of 985 under V8 —
// 87% of the whole, on a path a table walks once per cell per row. The members are the
// same objects either way; what changes is whether each instance carries its own slot
// for them.
//
// Under `Function.prototype` so the value stays CALLABLE and `instanceof Function`
// holds: callability is an internal slot, not something the prototype chain grants, but
// `.call`, `.bind` and the rest are reached through it.
//
// THE BRAND MOVES HERE TOO, and 1.6's guard is unaffected: `isReactive` reads the
// symbol, and an inherited read answers the same. The `defineProperty` it used to take
// was another 24 ns per value for a non-enumerability nothing reads.
//
// IT IS NOT ONLY CONSTRUCTION. A function carrying 43 own properties is a big enough
// object that V8 stops tracking it with a map, and every access to every field pays for
// that — so moving the members off the instance made the V8 numbers 1.7x on a read,
// 2.3x on `ready` and 3.7x on a write with one watcher (44.3 ns -> 12.1 ns), none of which
// was the change's motive. Bun's JSC and WebKit are flat to slightly better.
//
// A SYNTHETIC PROBE SAID THE OPPOSITE and was wrong, which is the note worth keeping: a
// stand-in with 14 no-op members read 2.33 ns -> 2.88 ns on the same path, so the trade
// looked real until the same measurement was taken on this file. The stand-in's members
// were small enough to keep the instance out of the slow mode the real ones put it in.
//
// THE BRAND IS PUT ON HERE RATHER THAN AT EACH PROTOTYPE, `scoped.ts`'s forwarder included. Every
// prototype is the same three lines with a different override record, and the one of them that
// mattered was the `defineProperty`: a prototype added without it is a value `isReactive` answers FALSE
// for, which every guard in the design reads first (1.6) — so the slot would hand a `Reactive`
// to `String()` and the template would render `[object Object]`, with nothing throwing.
export function brandedPrototype(
    overrides?: Record<PropertyKey, unknown>,
): Record<PropertyKey, unknown> {
    const prototype = Object.assign(
        Object.create(Function.prototype) as Record<PropertyKey, unknown>,
        MEMBERS,
        overrides,
    )
    Object.defineProperty(prototype, REACTIVE_BRAND, { value: true })
    return prototype
}

const MEMBER_PROTOTYPE = brandedPrototype()

// THE SAME MEMBERS WITH A STREAM'S WRITES — see `acceptIntoStream` for why they are not a branch.
// A value adopting a stream is moved onto this one while it forwards and back when it stops,
// which is a prototype change on one object at the moment an adoption starts or ends.
const STREAM_PROTOTYPE = brandedPrototype({
    set(this: Callable, value: unknown): unknown {
        return writeStream(this[CELL], value, true)
    },
    publish(this: Callable, value: unknown): unknown {
        const cell = this[CELL]
        const answer = writeStream(cell, value, false)
        return answer === undefined ? cell.ordinal : answer
    },
})

// THE SAME MEMBERS WITH AN ADOPTING VALUE'S WRITES, which reach what it adopts (11.60) — through that
// value's own members, so a stream's writes stay a stream's and an adoption of an adoption goes on
// down — an adopting source is on this prototype for exactly as long as `adoption` is set. A `Reactive` given to `set` is adopted HERE instead (11.62), or a value re-pointed at a new
// source would hand that source to the one it is leaving.
const ADOPTING_PROTOTYPE = brandedPrototype({
    set(this: Callable, value: unknown): unknown {
        const adoption = this[CELL].adoption
        if (adoption === null || isReactive(value))
            return MEMBERS.set.call(this, value)
        return (adoption.source.callable as Reactive<unknown>).set(value)
    },
    publish(this: Callable, value: unknown): unknown {
        const adoption = this[CELL].adoption
        if (adoption === null || isReactive(value))
            return MEMBERS.publish.call(this, value)
        return (adoption.source.callable as Reactive<unknown>).publish(value)
    },
    patch(this: Callable, mutate: (value: unknown) => void): void {
        const adoption = this[CELL].adoption
        if (adoption === null) patchCell(this[CELL], mutate)
        else (adoption.source.callable as Reactive<unknown>).patch(mutate)
    },
})

// THE SAME MEMBERS WITH THE COMMON WRITE SPELLED OUT, and a prototype rather than a branch
// for the reason `acceptIntoStream` already gives: a test in the shared `set` that a value
// can never take still costs that value. Measured — `identity: structural`, which fails such
// a test on its first load and goes on to the same `produce` it always did, went from 51 ns
// to 57 with the test in `set`, and to 57 again with the short arm moved behind its own
// frame instead, so it was never the size of `set`. The seat takes that value back to the
// baseline path exactly, because it IS the baseline path.
//
// ON A `simple` VALUE THAT IS ALREADY SERVING, `produce` -> `serve` -> `cascade` reduces to
// what is below: the ring, the cap, the expiry and the store are absent by `simple`; `moved`
// is false by the three state tests, so no probe moves and nothing settles; and every status
// field `serve` writes is already at the value it writes. The three state tests are the
// `moved` computation itself, read here to prove the rest is dead rather than to pick a
// branch, and anything they refuse falls through to `MEMBERS.set`, which is unchanged.
const SIMPLE_PROTOTYPE = brandedPrototype({
    set(this: Callable, value: unknown): unknown {
        const cell = this[CELL]
        if (
            cell.servable &&
            !cell.loading &&
            cell.failure === undefined &&
            (value === null ||
                (typeof value !== 'object' && typeof value !== 'function') ||
                typeof (value as PromiseLike<unknown>).then !== 'function')
        ) {
            // INSIDE THE ARM, so the fallback below bumps it once rather than twice.
            // A generation is only ever compared against a snapshot a load took, so
            // two bumps ahead of the snapshot discard exactly what one does — but the
            // field is the sort of thing a later reader comes to reason about, and a
            // write that counts as two is a thing to have to un-learn.
            cell.generation += 1
            // 5.2, and `simple` is what makes `Object.is` the whole gate.
            if (Object.is(value, cell.value)) {
                // The collapse arm's one lasting effect: `produce` restores `direct`
                // here, because a write can land on a value a mark walk has reached.
                cell.direct = cell.state === CLEAN
                return undefined
            }
            cell.value = value
            // 6.18: an `undefined` is served and moves no ordinal.
            if (value !== undefined) cell.ordinal += 1
            // `setDirect`, with `plain` known true by `simple`.
            cell.direct = cell.state === CLEAN
            if (cell.readers.length !== 0) markReaders(cell, DIRTY)
            // `cascade`'s tail. A write made from inside an effect appends to the drain
            // already walking rather than opening a second one.
            if (!draining && pendingCount !== 0) schedule()
            return undefined
        }
        return MEMBERS.set.call(this, value)
    },
})

export function createReactive<
    Stored,
    Accepted,
    Failures extends Failed<string, unknown>,
    Produced = Stored,
>(
    label: string,
    body: ((args: unknown) => unknown) | null,
    args: unknown,
    initial: unknown,
    options: ReactiveOptions<Accepted, Stored, Failures> | undefined,
    // 5.20: a keyed value's window decides when this entry's producer starts, not the reach.
    deferred = false,
): Reactive<Stored, Accepted, Failures, Produced> {
    // 11.42 IS A COMPILE ERROR THE TYPES CANNOT RAISE: a body declaring no parameter is still
    // assignable to the keyed overload's `(args: Args) => Computed`, so the checker falls through
    // to it and accepts the call. Like 5.15 it lands at construction instead, the earliest moment
    // there is — and a keyed value strips `args` before building an entry, so any that arrives
    // here was spelled on a form that has no args to gate.
    if ((options as { args?: unknown } | undefined)?.args !== undefined)
        throw new Error(
            `${label} declares args with no parameter to gate. args belongs to a keyed reactive, whose body declares one.`,
        )
    // 9.20, READ ONCE: the declaration is the function's kind, and nothing after this asks.
    const streaming = body !== null && isStreamBody(body)
    const cell = new Cell(
        label,
        body,
        args,
        options as ReactiveOptions<unknown, unknown, never> | undefined,
        streaming,
    )
    // THE READ IS THE CALLABLE'S OWN BODY, not a call it makes. It stood as
    // `return read(self)` and that was a second frame on the hottest path in the design —
    // a template pays it per slot per row, and a recompute pays it once per source it
    // reads plus once for itself.
    //
    // IT CAPTURES `cell` AND NOTHING ELSE. Every other local here is dead by the time it
    // returns, so the scope it keeps alive is the one slot the read needs.
    const self = function readValue(): unknown {
        // TRACKING, WITH ITS COMMON ARM SPELLED OUT. A body reads the same values in the
        // same order on almost every run, so the shape that matters is "the source at the
        // cursor is the one we already had" — a pointer compare and an increment, with no
        // call and no set operation. `track` is the divergence.
        const reader = TRACKING.reader
        if (reader !== null) {
            const at = reader.cursor
            if (reader.sources[at] === cell) reader.cursor = at + 1
            else track(cell, reader)
        }
        // ONE LOAD AND ONE BRANCH FOR THE WHOLE COMMON PATH. `direct` is the pull and
        // the refusal answered at once — see its declaration. It stood as
        // three tests and stripping them to one measured 2.39 ns -> 1.86 ns on a read and
        // 4.03 ns -> 3.07 ns over a thousand values, which is memory traffic rather than
        // branches: a read walked four fields where the hand-written arm reads one
        // captured variable.
        if (cell.direct) return cell.value
        return readIndirect(cell)
    } as unknown as Callable
    // BEFORE THE FIELD, not after: an engine keys its inline caches on the shape a
    // property was added to, and re-pointing the prototype afterwards invalidates the
    // transition the store just built.
    Object.setPrototypeOf(
        self,
        streaming
            ? STREAM_PROTOTYPE
            : cell.simple
              ? SIMPLE_PROTOTYPE
              : MEMBER_PROTOTYPE,
    )
    self[CELL] = cell
    cell.callable = self as unknown as Reactive<unknown>
    if (cell.tags !== null) tagCell(cell)

    // 1.7: reaching an instance starts the work it is for. For the value form that is
    // the initial write; for a body it is the first run, which 11.4 has happening once
    // per key rather than once per read.
    //
    // AN ABSENT OPENING VALUE MINTS NOTHING, and it is the same sentence whatever the
    // retention. A value nobody has published to retains NOTHING rather than one
    // `undefined`, and a value nobody has written reads as not landed (2.2, 9.14) rather
    // than serving an `undefined` its own type says is a `Stored`.
    // Withholding this from the untailed form was the exception CLAUDE.md's uniformity
    // bias refuses: the same option, one producer, two readings.
    // 8.3 AND 8.14: a store answers first, where the value is constructed, and whatever it misses
    // falls back to what the value would have done without one.
    if (cell.store !== null) restoreFirst(cell, cell.store, initial)
    else if (body === null) {
        if (initial === undefined) landOpening(cell)
        else if (initial !== NO_INITIAL) absorb(cell, initial, true, false)
    } else if (deferred) cell.loading = true
    else startProducer(cell)
    return self as unknown as Reactive<Stored, Accepted, Failures, Produced>
}
