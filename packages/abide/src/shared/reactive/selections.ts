// THE SELECTION INDEX (13.1, 13.3, 13.6): which values carry which tag, which loads a bare sweep
// reaches, and the one probe signal per selection a guard subscribes to. Over the cell's `tags`,
// `ref`, `filed`, `scope` and `global` and nothing else of it — what a selection DOES to the values
// it reaches (`busyOver`, `refreshOver`, …) is the graph's, and stays in `Reactive.ts`.

import { type Cell, cellOf } from './cellShape.ts'
import { currentScope } from './scoping.ts'
import {
    newTracked,
    type Subscriber,
    type Tracked,
    TRACKING,
    trackProbe,
} from './tracking.ts'

/**
 * Each tag to the values carrying it, held weakly.
 *
 * THE INDEX HOLDS VALUES WEAKLY. A tag is a way to find a value, never a reason to keep one, and a
 * strong index would hold every tagged value a page ever made for the life of the process. A
 * collected value is pruned from its sets by the next sweep that finds it gone.
 */
const TAGGED = new Map<string, Set<WeakRef<Cell>>>()

/**
 * Every value whose producer is a LOAD, held weakly — what a bare selection sweeps.
 *
 * 13.6: A BARE SWEEP REACHES PRODUCERS, and of those it files the ones that LOAD: a value holding
 * a `store`, filed where it is built, and a body the first time it starts a load — a pending
 * answer or a stream (`beginLoad`). A synchronous body is a derivation: reloading it recomputes
 * what its sources already say, and whatever load it reads is filed on its own. And filing is
 * what every filed value pays — a weak handle measured ~230 ns a value under V8 against ~20 under
 * JSC — so a value with nothing to load never pays it: a derivation per cell per row stays at
 * what it cost before, and a load pays it beside the promise it already allocates.
 *
 * Held weakly for `TAGGED`'s reason. AN ARRAY, COMPACTED, RATHER THAN A `Set`: a `Set` of weak
 * handles measured ~120 ns a filing under JSC against ~10 for a push. What a `Set` bought was an
 * O(1) delete on eviction; here an evicted value drops its `ref` instead, and a handle whose value
 * no longer points back at it is dead, the same as one whose value was collected. Because a bare
 * sweep may never run, the filing that finds the array past `compactProducersAt` compacts it, and
 * the bar doubles past what survives, so the walk is amortized over the filings between two.
 */
let filedProducers: WeakRef<Cell>[] = []
let compactProducersAt = 1024

/**
 * The probe signal a guard over a selection subscribes to.
 *
 * 13.3 AND 13.9: ONE SIGNAL PER SELECTION, keyed by its canonical tags. A guard over a selection
 * subscribes to this, never to each entry — the probe edge `trackProbe` makes, from a node that
 * is nothing but that edge.
 */
const SIGNALS = new Map<string, Tracked>()
const SIGNALS_BY_TAG = new Map<string, Tracked[]>()
/**
 * The bare selection's one signal. Not a key in `SIGNALS`: `{ tags: [] }` canonicalizes to the
 * empty set and matches nothing, where the bare selection matches every filed load in reach.
 */
export const EVERY_PRODUCER = newTracked()

function refOf(cell: Cell): WeakRef<Cell> {
    let ref = cell.ref
    if (ref === null) {
        ref = new WeakRef(cell)
        cell.ref = ref
    }
    return ref
}

export function tagCell(cell: Cell): void {
    const ref = refOf(cell)
    for (const tag of cell.tags as string[]) {
        let carrying = TAGGED.get(tag)
        if (carrying === undefined) {
            carrying = new Set()
            TAGGED.set(tag, carrying)
        }
        carrying.add(ref)
    }
}

export function fileProducer(cell: Cell): void {
    cell.filed = true
    filedProducers.push(refOf(cell))
    if (filedProducers.length > compactProducersAt) {
        filedProducers = liveProducers()
        compactProducersAt = Math.max(1024, filedProducers.length * 2)
    }
}

/** The handles whose value is still standing and still filed — neither collected nor evicted. */
function liveProducers(): WeakRef<Cell>[] {
    const live: WeakRef<Cell>[] = []
    for (let index = 0; index < filedProducers.length; index += 1) {
        const ref = filedProducers[index] as WeakRef<Cell>
        if (ref.deref()?.ref === ref) live.push(ref)
    }
    return live
}

/**
 * Removes an evicted value from every selection index.
 *
 * What an eviction calls: an entry out of its `Keyed` is out of every selection with it, rather
 * than reachable by a sweep until a collection happens to run.
 */
export function leaveSelections(value: unknown): void {
    const cell = cellOf(value)
    const ref = cell.ref
    if (ref === null) return
    // What takes it out of `filedProducers`: a handle its value no longer points back at is dead.
    cell.ref = null
    if (cell.tags === null) return
    for (const tag of cell.tags) {
        const carrying = TAGGED.get(tag)
        if (carrying === undefined) continue
        carrying.delete(ref)
        if (carrying.size === 0) TAGGED.delete(tag)
    }
}

/**
 * Takes every value filed so far out of the bare selection, each filed again by its next load.
 *
 * A TEST'S SEAM, with no caller in the framework — `bareSelection.test.ts` calls it before its
 * first case: a page's process ends with the page, and a test process runs every file before this
 * one in it. What those files left held — a module's `global`
 * value, a follow the page keeps for its life — is in reach of a bare sweep (13.13), and a bare
 * `refresh()` reloads it and reads `busy()` true while it asks.
 */
export function unfileProducers(): void {
    for (let index = 0; index < filedProducers.length; index += 1) {
        const cell = (filedProducers[index] as WeakRef<Cell>).deref()
        if (cell !== undefined) cell.filed = false
    }
    filedProducers = []
}

/**
 * The values a selection reaches in the current scope, `global` values included: those carrying
 * any of `tags`, or every filed load where `tags` is `null` — the bare selection.
 *
 * 13.8 — A SELECTION IS SCOPE-BOUNDED, and a tag with it, so a selection inside one request never
 * reaches the values another request filed. 13.13 — a `global` value is in every scope, so every
 * selection reaches it, and 13.10 is the bare case of that. In a browser every cell's scope is
 * `undefined`, and so is this.
 */
export function inReach(tags: string[] | null): Cell[] {
    const scope = currentScope()
    if (tags === null) {
        filedProducers = liveProducers()
        const found: Cell[] = []
        for (let index = 0; index < filedProducers.length; index += 1) {
            const cell = (
                filedProducers[index] as WeakRef<Cell>
            ).deref() as Cell
            if (cell.scope === scope || cell.global) found.push(cell)
        }
        return found
    }
    const found = new Set<Cell>()
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

export function trackSignal(tags: string[] | null): void {
    const reader = TRACKING.reader
    if (reader === null) return
    if (tags === null) {
        trackProbe(EVERY_PRODUCER, reader)
        return
    }
    const key = JSON.stringify([...new Set(tags)].sort())
    let signal = SIGNALS.get(key)
    if (signal === undefined) {
        signal = newTracked()
        SIGNALS.set(key, signal)
        for (const tag of tags) {
            const signals = SIGNALS_BY_TAG.get(tag)
            if (signals === undefined) SIGNALS_BY_TAG.set(tag, [signal])
            else signals.push(signal)
        }
    }
    trackProbe(signal, reader)
}

/**
 * Hands `mark` the probe readers of every selection signal over any of `tags` (13.3).
 *
 * `mark` is the core's `markAsked`, passed rather than imported so this index stays off the graph.
 */
export function markSignals(
    tags: string[],
    mark: (asked: Subscriber[]) => void,
): void {
    for (const tag of tags) {
        const signals = SIGNALS_BY_TAG.get(tag)
        if (signals === undefined) continue
        for (const signal of signals) mark(signal.probeReaders)
    }
}
