// The effect. RULEBOOK 12.2: runs immediately, and again whenever a reactive value it
// read changes.
//
// TWO FORMS, ONE DISCRIMINATED BY ARITY. The bare form is TRACKED — 14.6 makes the body a
// tracked context, so what it reads is discovered by running it. The narrowed form is
// given its sources (12.3) and runs only when those change, so its body is not a tracked
// context at all and a read inside it subscribes to nothing.
//
// ARITY RATHER THAN SHAPE, and the reason is a seam: telling an `Effect` from a `Reactive`
// by inspection means reading the brand, which lives in `Reactive.ts` — and `Reactive.ts`
// imports the narrowed form from here. A second argument is the author saying which form
// they meant, and it needs nothing from the other module but a type.

import { namedLogger } from '../log.ts'
import { UNEXPECTED } from '../UNEXPECTED.ts'
import { WORK } from '../WORK.ts'
import { CELL } from './CELL.ts'
import { NotLanded } from './NotLanded.ts'
import type { Reactive } from './Reactive.ts'
import { currentScope, runInScope } from './scoping.ts'
import {
    detach,
    newSubscriber,
    type Subscriber,
    TRACKING,
    type Tracked,
    truncate,
    truncateProbes,
    untracked,
} from './tracking.ts'

export type Disposer = () => void
// biome-ignore lint/suspicious/noConfusingVoidType: `void` is an EFFECT'S RETURN POSITION and is load-bearing. `undefined` there refuses the ordinary effect — a block body that returns nothing infers `void`, which is not assignable to `undefined` — so the rule's own fix would reject every caller that does not return a disposer.
export type Effect = () => void | Disposer

const WATCH_LOG = namedLogger('abide:watch')

/**
 * Warns on `abide:watch` and hands the throw to `onError` where there is one.
 *
 * 12.6 — a read of a failed value inside an effect arrives here as the throw that read is.
 */
function reportThrow(thrown: unknown, message: string): void {
    WATCH_LOG.warning(message, thrown)
    UNEXPECTED.report?.(thrown)
}

/**
 * Reports an effect's throw, then re-throws it in a browser.
 *
 * 12.7 — A BROWSER HAS NO `onError`, so the throw goes on out to surface as an uncaught error. A
 * server's has been handed it, and re-thrown there it would fail the handler or the render whose
 * write woke this effect — a second report of one failure, against code that did not fail.
 */
function effectThrew(thrown: unknown): void {
    reportThrow(
        thrown,
        'an effect threw, and its watch is stopped. RULEBOOK 12.6, 12.8.',
    )
    if (typeof document !== 'undefined') throw thrown
}

/**
 * Runs a disposer untracked, reporting a throw from it rather than letting it stop the effect's
 * rerun.
 *
 * 14.10 — UNTRACKED, because a teardown runs wherever the stop was called from: a watch stopped
 * inside another's effect subscribed that effect to whatever the disposer read.
 */
function runDisposer(dispose: Disposer): void {
    try {
        untracked(dispose, undefined, undefined)
    } catch (thrown) {
        reportThrow(thrown, 'a disposer threw. RULEBOOK 12.6.')
    }
}

/**
 * Where the watches a component's setup opens are collected, or `undefined` outside a setup.
 *
 * 12.4 — A SETUP'S WATCHES ARE ITS SCOPE'S: the scope is made before the setup runs and its `stops`
 * is the collector, so what the setup opens has its owner from the start — a routed level's
 * included, whose markup is deferred (41.19). The setup's code is the author's and calls `watch`
 * with no scope in hand, which is why this is ambient rather than an argument.
 */
const OWNING: { stops: Disposer[] | undefined; free: boolean } = {
    stops: undefined,
    free: false,
}

/** Collects every watch opened from here into `stops`; answers the collector it replaced. */
export function collectWatches(
    stops: Disposer[] | undefined,
): Disposer[] | undefined {
    const previous = OWNING.stops
    OWNING.stops = stops
    return previous
}

/**
 * Hands `dispose` to the setup being collected, if one is, and to the scope it was opened in, if
 * there is one; answers it.
 *
 * 12.5 — the scope is a server's request (`currentScope`), which a browser never has.
 */
export function owned(dispose: Disposer): Disposer {
    if (OWNING.free) return dispose
    const stops = OWNING.stops
    if (stops !== undefined) stops.push(dispose)
    currentScope()?.stops.push(dispose)
    return dispose
}

/**
 * Whether something opened now has an owner to be handed to — a setup being collected, or a scope.
 *
 * Asked before allocating the stop a value built here would hand over, so a value built anywhere
 * else allocates nothing for it.
 */
export function owning(): boolean {
    return (
        !OWNING.free &&
        (OWNING.stops !== undefined || currentScope() !== undefined)
    )
}

/**
 * Runs `open`, and answers what it answers, with every watch it opens owned by its caller alone.
 *
 * FOR A WATCH WHOSE LIFE IS ALREADY HELD — a followed `GET`'s feed, stopped when its last follower
 * leaves — and which a request or a setup it happened to start in would otherwise stop when that
 * one ends.
 */
export function unowned<Result>(open: () => Result): Result {
    const previous = OWNING.free
    OWNING.free = true
    try {
        return open()
    } finally {
        OWNING.free = previous
    }
}

/** Runs `effect` now, and again whenever a reactive value it read changes. */
export function watch(effect: Effect): Disposer
/** Runs `effect` now and whenever one of `sources` changes; its own reads subscribe to nothing. */
export function watch(
    // `never` for what a source accepts: it is subscribed to and never written, and a list of
    // sources holding different values has no one `Stored` to be inferred as.
    // SPELLED OUT RATHER THAN ALIASED: the compiler tells a position that holds the `Reactive` by
    // the type's own symbol (31.3), and behind an alias `watch([n], …)` lowered to `watch([n()], …)`.
    sources:
        | Reactive<unknown, never, unknown, unknown>
        | Reactive<unknown, never, unknown, unknown>[],
    effect: Effect,
): Disposer
export function watch(first: unknown, second?: Effect): Disposer {
    if (second === undefined) return owned(watchTracked(first as Effect))
    // An app hands over the VALUES; the reader list lives on each one's record. Copied
    // rather than aliased, because the reader keeps this array for its whole life and the
    // app's own array is the app's to mutate.
    const given = (Array.isArray(first) ? first : [first]) as {
        [CELL]: Tracked
    }[]
    const sources: Tracked[] = []
    for (let index = 0; index < given.length; index += 1)
        sources.push((given[index] as { [CELL]: Tracked })[CELL])
    return owned(watchOver(sources, null, second))
}

/**
 * Runs `effect` now and again whenever one of the declared `sources` changes, untracked.
 *
 * THE NARROWED FORM, and what `s.watch` is (12.9). The sources are pushed into rather than
 * discovered, so there is no tracked context, no cursor and no divergence — which is also why a
 * read inside one of these subscribes to nothing.
 *
 * `adopter` says what is being asked for: `null` is an effect, which the end of the turn may run,
 * and a value is an adoption's MIRROR into it, which carries a value and cannot wait — see
 * `isMirror` and `adopter` in `tracking.ts`.
 */
export function watchOver(
    sources: Tracked[],
    adopter: Tracked | null,
    effect: Effect,
): Disposer {
    // biome-ignore lint/suspicious/noConfusingVoidType: `void` is an EFFECT'S RETURN POSITION and is load-bearing. `undefined` there refuses the ordinary effect — a block body that returns nothing infers `void`, which is not assignable to `undefined` — so the rule's own fix would reject every caller that does not return a disposer.
    let dispose: Disposer | void
    // The sources are declared rather than tracked. `detach` still tears this down: it truncates
    // from the cursor, and the cursor of a body that never tracked is zero.
    const reader: Subscriber = newSubscriber(sources, adopter)
    // 11.32 — the scope a rerun reads through: see `watchTracked`.
    const scope = currentScope()
    reader.notify = (): void => {
        if (!reader.alive) return
        // 12.1: the disposer runs before each rerun of its effect.
        if (typeof dispose === 'function') runDisposer(dispose)
        dispose = undefined
        // `running` is what `markReaders` reads to skip a body already on the stack.
        // A subscriber that never sets it has no re-entrancy guard at all: an effect
        // that writes something it reads re-entered itself once per write, unbounded.
        reader.running = true
        // UNTRACKED, AND THE CLEAR IS WHAT MAKES IT SO. The sources are given rather
        // than discovered, but the effect still RUNS wherever it was reached from — a
        // `s.watch` opened inside a `watch` had its reads attributed to the OUTER
        // reader, which then re-ran on a value it never read. A mirror is the same
        // shape one turn up: it runs inside the mark walk, and 4.7 has the `transform`
        // it calls there running untracked.
        const previous = TRACKING.reader
        TRACKING.reader = null
        try {
            WORK.wakes += 1
            dispose = runInScope(scope, effect, undefined)
        } catch (thrown) {
            TRACKING.reader = previous
            reader.running = false
            // `NotLanded` is not an effect that failed, it is one whose turn has not
            // come — and the source that has not landed is one this reader is already
            // subscribed to, so its landing is what runs this again.
            if (thrown instanceof NotLanded) return
            // 12.8: one that throws once usually throws every run, and a watch
            // re-running into the same throw is a loop with a log line per iteration.
            reader.alive = false
            detach(reader)
            effectThrew(thrown)
            return
        }
        TRACKING.reader = previous
        reader.running = false
    }
    for (let index = 0; index < sources.length; index += 1)
        (sources[index] as Tracked).readers.push(reader)
    reader.notify()
    // ONCE, however many owners stop it — a setup's scope and a request's both can — since 12.1
    // gives the disposer one run at teardown.
    return (): void => {
        if (!reader.alive) return
        reader.alive = false
        detach(reader)
        if (typeof dispose === 'function') runDisposer(dispose)
    }
}

/**
 * The bare form: runs `effect` as a tracked context, re-running when anything it read changes.
 *
 * UNOWNED — the caller holds the stop. `watch` is this handed to its owners (`owned`); a template
 * binding's `Scope` and a `{#try}`'s retry hold their own, and call this direct.
 *
 * A SECOND BODY BESIDE `watchOver` ON PURPOSE, and it reads as the duplication it is: the two
 * differ by the cursor resets and the tail trims, and the rest is the same lines.
 * ONE BODY WITH A `tracked` FLAG WAS BUILT AND MEASURED, under V8 against this pair, interleaved
 * four runs a side: `write a value that changed` — one bound watch — went 15.6 ns to 21.4 in every
 * run, and `mount 50 readers` +12% (+7% under JSC). Three flag tests cannot cost 6 ns. The likely
 * mechanism, inferred rather than traced: every closure made from one literal shares its call-site
 * feedback, so the template binding's `effect()` call became every `s.watch` effect's and every
 * adoption mirror's too. Two literals keep that call site to the effects a template makes.
 */
export function watchTracked(effect: Effect): Disposer {
    // biome-ignore lint/suspicious/noConfusingVoidType: `void` is an EFFECT'S RETURN POSITION and is load-bearing. `undefined` there refuses the ordinary effect — a block body that returns nothing infers `void`, which is not assignable to `undefined` — so the rule's own fix would reject every caller that does not return a disposer.
    let dispose: Disposer | void
    const reader: Subscriber = newSubscriber([], null)
    // 11.32 — A RERUN READS THROUGH THE SCOPE THE WATCH WAS OPENED IN, not the ambient one. The
    // drain that reruns it runs in whichever request's turn scheduled it, so without this an
    // effect a load aborted (11.63) reruns reading — and subscribing to — another request's
    // values. The same move `run` makes for a body.
    const scope = currentScope()
    reader.notify = (): void => {
        if (!reader.alive) return
        // 12.1: the disposer runs before each rerun, and once more at teardown.
        if (typeof dispose === 'function') runDisposer(dispose)
        dispose = undefined
        // A conditional read makes the previous run's list the wrong list — but
        // rebuilding it wholesale is what the cursor in `tracking` exists to
        // avoid, so the list is walked rather than cleared.
        const previous = TRACKING.reader
        TRACKING.reader = reader
        reader.cursor = 0
        reader.probeCursor = 0
        reader.running = true
        try {
            WORK.wakes += 1
            dispose = runInScope(scope, effect, undefined)
        } catch (thrown) {
            reader.running = false
            TRACKING.reader = previous
            if (reader.cursor < reader.sources.length) truncate(reader)
            if (reader.probeCursor < reader.probeSources.length)
                truncateProbes(reader)
            // The abort reaches here too: an effect that read a value which has
            // not landed is not an effect that failed, it is one whose turn has
            // not come. The read subscribed before it threw, so the value landing
            // is what runs it.
            if (thrown instanceof NotLanded) return
            // 12.8: one that throws once usually throws every run.
            reader.alive = false
            detach(reader)
            effectThrew(thrown)
            return
        }
        reader.running = false
        TRACKING.reader = previous
        if (reader.cursor < reader.sources.length) truncate(reader)
        if (reader.probeCursor < reader.probeSources.length)
            truncateProbes(reader)
    }
    reader.notify()
    return (): void => {
        if (!reader.alive) return
        reader.alive = false
        detach(reader)
        if (typeof dispose === 'function') runDisposer(dispose)
    }
}
