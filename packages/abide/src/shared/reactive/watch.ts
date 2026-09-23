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

import { WORK } from '../WORK.ts'
import { CELL } from './CELL.ts'
import { NotLanded } from './NotLanded.ts'
import type { Reactive } from './Reactive.ts'
import {
    detach,
    detachProbes,
    newSubscriber,
    type Subscriber,
    TRACKING,
    type Tracked,
    truncate,
} from './tracking.ts'

export type Disposer = () => void
// biome-ignore lint/suspicious/noConfusingVoidType: `void` is an EFFECT'S RETURN POSITION and is load-bearing. `undefined` there refuses the ordinary effect — a block body that returns nothing infers `void`, which is not assignable to `undefined` — so the rule's own fix would reject every caller that does not return a disposer.
export type Effect = () => void | Disposer

export function watch(effect: Effect): Disposer
export function watch<Stored>(
    sources: Reactive<Stored> | Reactive<Stored>[],
    effect: Effect,
): Disposer
export function watch(first: unknown, second?: Effect): Disposer {
    if (second === undefined) return watchTracked(first as Effect)
    // An app hands over the VALUES; the reader list lives on each one's record. Copied
    // rather than aliased, because the reader keeps this array for its whole life and the
    // app's own array is the app's to mutate.
    const given = (Array.isArray(first) ? first : [first]) as {
        [CELL]: Tracked
    }[]
    const sources: Tracked[] = []
    for (let index = 0; index < given.length; index += 1)
        sources.push((given[index] as { [CELL]: Tracked })[CELL])
    return watchOver(sources, null, second)
}

// THE NARROWED FORM, and what `s.watch` is (12.9). The sources are pushed into rather than
// discovered, so there is no tracked context, no cursor and no divergence — which is also
// why a read inside one of these subscribes to nothing.
// `adopter` says what is being asked for: `null` is an effect, which the end of the turn may
// run, and a value is an adoption's MIRROR into it, which carries a value and cannot wait —
// see `isMirror` and `adopter` in `tracking.ts`.
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
    reader.notify = (): void => {
        if (!reader.alive) return
        // 12.1: the disposer runs before each rerun of its effect.
        if (typeof dispose === 'function') dispose()
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
            dispose = effect()
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
            throw thrown
        }
        TRACKING.reader = previous
        reader.running = false
    }
    for (let index = 0; index < sources.length; index += 1)
        (sources[index] as Tracked).readers.push(reader)
    reader.notify()
    return (): void => {
        reader.alive = false
        detach(reader)
        if (typeof dispose === 'function') dispose()
    }
}

function watchTracked(effect: Effect): Disposer {
    // biome-ignore lint/suspicious/noConfusingVoidType: `void` is an EFFECT'S RETURN POSITION and is load-bearing. `undefined` there refuses the ordinary effect — a block body that returns nothing infers `void`, which is not assignable to `undefined` — so the rule's own fix would reject every caller that does not return a disposer.
    let dispose: Disposer | void
    const reader: Subscriber = newSubscriber([], null)
    reader.notify = (): void => {
        if (!reader.alive) return
        // 12.1: the disposer runs before each rerun, and once more at teardown.
        if (typeof dispose === 'function') dispose()
        dispose = undefined
        // A conditional read makes the previous run's list the wrong list — but
        // rebuilding it wholesale is what the cursor in `tracking` exists to
        // avoid, so the list is walked rather than cleared.
        const previous = TRACKING.reader
        TRACKING.reader = reader
        reader.cursor = 0
        if (reader.probeSources.length !== 0) detachProbes(reader)
        reader.running = true
        try {
            WORK.wakes += 1
            dispose = effect()
        } catch (thrown) {
            reader.running = false
            TRACKING.reader = previous
            if (reader.cursor < reader.sources.length) truncate(reader)
            // The abort reaches here too: an effect that read a value which has
            // not landed is not an effect that failed, it is one whose turn has
            // not come. The read subscribed before it threw, so the value landing
            // is what runs it.
            if (thrown instanceof NotLanded) return
            // 12.8: one that throws once usually throws every run.
            reader.alive = false
            detach(reader)
            throw thrown
        }
        reader.running = false
        TRACKING.reader = previous
        if (reader.cursor < reader.sources.length) truncate(reader)
    }
    reader.notify()
    return (): void => {
        reader.alive = false
        detach(reader)
        if (typeof dispose === 'function') dispose()
    }
}
