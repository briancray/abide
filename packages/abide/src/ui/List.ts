import { listOf } from '#shared/listOf.ts'
import { untracked } from '#shared/reactive/tracking.ts'
import { HYDRATE_LOG, Mismatch, warnMismatch } from './Mismatch.ts'
import {
    dropRow,
    makeRow,
    type Row,
    reconcile,
    rowOf,
    rowsIn,
} from './reconcile.ts'
import { isEmptyRegion, type Region, removeUntil } from './regions.ts'
import type { Scope } from './Scope.ts'

// ONE RECORD PER `{#for}`, owned by the emitted block, holding everything the two arms — the
// reconcile of a list and the append of an async subject — have to tell each other: which source
// is pumping, and whether the repeated-key warning has fired. Each edge between the two modes is a
// field here rather than a patch to a module-level map keyed on the region.
export class List {
    region: Region
    rows: Row[]
    // THE ASYNC ITERABLE BEING PUMPED, or null. The newest source wins and the pump it replaced
    // stops at its next item, and a list arriving in its place stops it the same way.
    pumping: unknown
    // 41.15 — once for the block, not once a reconcile.
    warned: boolean
    // WHETHER THE ROWS ARE STILL THE SERVER'S. The first update HYDRATES them rather than
    // reconciling, and clears this.
    hydrating: boolean
    // Whether each row carries its own anchor — a body with several top-level nodes.
    anchored: boolean
    key: (item: unknown, at: number) => unknown
    // ONCE PER ROW, the `make` and `mount` that row is built and mounted by. 14.8 — a row with a
    // branch-local `<script>` runs it here and gets builders closing over its names; every other
    // list hands back the one record it was built with, so a row allocates nothing more.
    setUp: (item: unknown, at: number) => RowBuilders

    constructor(
        region: Region,
        rows: Row[],
        key: (item: unknown, at: number) => unknown,
        setUp: (item: unknown, at: number) => RowBuilders,
    ) {
        this.region = region
        this.rows = rows
        this.pumping = null
        this.warned = false
        this.hydrating = false
        this.anchored = false
        this.key = key
        this.setUp = setUp
    }

    // 12.13 — WHAT THE BLOCK'S OWN SCOPE STOPS WHEN THE REGION HOLDING IT LEAVES. A row's bindings
    // are stopped by `dropRow` as the list churns, but a `{#for}` removed whole — a row above it
    // dropping, an arm swapping out — drops no rows at all, and every row it still holds would go
    // on waking. The nodes go with the region, so only the scopes are stopped here.
    stop(): void {
        const rows = this.rows
        for (const row of rows) row.scope.stop()
        rows.length = 0
        this.pumping = null
    }
}

// A `{#for}` whose rows the SERVER wrote. Nothing is wired until the first update, which is the
// block's watch running once: the subject is read there and only there, so the rows are hydrated
// against the same items the watch then compares against. Read twice — once to hydrate and again
// on the watch's first run — a subject that builds fresh items (`rows.map(…)`) matched no row by
// identity, and every row the server sent was dropped and remade on load.
export function listAt(
    region: Region,
    anchored: boolean,
    key: (item: unknown, at: number) => unknown,
    setUp: (item: unknown, at: number) => RowBuilders,
): List {
    const list = new List(region, [], key, setUp)
    list.hydrating = true
    list.anchored = anchored
    return list
}

// HYDRATION, NOT RENDERING. The rows are already there; wiring them is all that is left. 41.3 — an
// async subject rendered no rows, so it finds none here.
//
// FALSE WHERE THERE IS NOTHING TO RETURN ON, and the caller reconciles what was hydrated instead.
// TWO DIFFERENT QUESTIONS REACH THIS, and answering both with one length compare hid the second:
//
// NOBODY PAINTED THIS REGION is 41.4 — a render continues past a subject still in flight, which
// writes the anchors and no rows. That is not a disagreement, because there is nothing to disagree
// with, so it builds in silence. `isEmptyRegion` is the signal the rest of the block machinery
// already reads for exactly this (32.18), rather than a zero this function infers on its own.
//
// THE SERVER'S ROWS ARE NOT THE CLIENT'S ITEMS is 41.10, and it MUST warn. Hydration wires row
// `at` to item `at` BY POSITION, so a run where the two lengths disagree has items with no node,
// nodes with no item, or both — every one of them a `{#for}` that looks right and is dead, because
// `updateList` returned before `reconcile` could fix it. Repairing that silently is the clause
// half-applied: the divergence is a document and a client that disagree, which is the one thing
// the channel exists to report.
//
// THE LENGTHS ARE COMPARED BEFORE A ROW IS WIRED, and only the rows both sides hold are. A row the
// document holds past the last item has no item to key or set up — handed `undefined`, a keyed
// list threw a TypeError out of `item[by]`, which is not a `Mismatch` and so took the page down on
// exactly the disagreement this reports. Those rows are removed here, and the reconcile after
// builds whatever the document was short.
function hydrate(list: List, items: unknown[]): boolean {
    const found = rowsIn(list.region, list.anchored)
    if (found.length === 0 && isEmptyRegion(list.region)) return false
    const agreed = found.length === items.length
    if (!agreed) {
        warnMismatch(
            new Mismatch(
                `abide: the document holds ${found.length} rows where this {#for} computes ${items.length}, so the client and the server disagree about this region's shape (41.10).`,
            ),
        )
        if (found.length > items.length)
            removeUntil(found[items.length] as ChildNode, list.region.close)
    }
    const wired = Math.min(found.length, items.length)
    for (let at = 0; at < wired; at += 1) {
        const item = items[at]
        list.rows.push(
            rowOf(
                list.setUp(item, at),
                list.key(item, at),
                item,
                found[at] as ChildNode,
                at,
            ),
        )
    }
    return agreed
}

// 32.15 — AN ARRAY RECONCILES AND AN ASYNC SUBJECT APPENDS AS ITEMS ARRIVE. There is no list to
// diff an async subject against: the items are not all there, and the arrival of one says nothing
// about the ones behind it.
//
// THE SUBJECT IS READ TRACKED AND THE ROWS ARE BUILT UNTRACKED. `make` evaluates a row's attributes
// as it builds them, so under the list's watch a row reading `selected` subscribed the WHOLE list to
// it — one full reconcile per write after any row was built here. A row's own reads are its mount's
// watches. `listOf` stays outside: spreading an iterable is a read of it.
export function updateList(list: List, subject: unknown): void {
    untracked(settleList, list, listOf(subject))
}

function settleList(
    list: List,
    items: unknown[] | AsyncIterable<unknown>,
): void {
    const hydrating = list.hydrating
    list.hydrating = false
    if (!Array.isArray(items)) {
        appendRows(list, items)
        return
    }
    if (hydrating && hydrate(list, items)) return
    list.pumping = null
    reconcile(list, items)
}

// 41.3 IS THE SERVER'S HALF OF 32.15 — the render is not held for an unfinished stream, so an
// async subject writes no rows inline and the region arrives empty. The pump fills it.
function appendRows(list: List, source: AsyncIterable<unknown>): void {
    // A RE-RUN IS NOT A NEW SOURCE. The subject is read inside a watch, so any other reactive
    // the expression touches re-runs it with the SAME iterable — and emptying the list to pump an
    // async generator that has already run to completion left the region blank for good.
    if (list.pumping === source) return
    // A NEW SOURCE IS A NEW LIST. What the last one appended is stopped and removed, or its
    // readers wake for the life of the page writing into nodes the next source appends after.
    for (const row of list.rows) dropRow(row)
    list.rows = []
    list.pumping = source
    // A FLOATING PROMISE IS THE ONE FAILURE THIS SEAM CANNOT WARN ABOUT. `pump` awaits the app's
    // own iterable and calls `make`/`mount`, so a stream that aborts and a row that cannot be
    // hydrated both reject it — and with nothing attached that is a fatal `unhandledRejection`
    // under bun and a bare `unhandledrejection` in a browser, where every other failure in this
    // seam is one `abide:hydrate` line. The sibling pump in `Reactive.ts` routes its failure the
    // same way rather than letting it escape.
    pump(list, source).catch((thrown: unknown) => {
        if (warnMismatch(thrown)) return
        HYDRATE_LOG.warning(thrown)
    })
}

async function pump(list: List, source: AsyncIterable<unknown>): Promise<void> {
    const region = list.region
    let at = 0
    for await (const item of source) {
        // READ PER ITEM, not once before the loop: the region's parent is read again because the
        // document may have moved on between two arrivals, and a detached region is where this
        // stops rather than where it throws.
        const parent = region.close.parentNode
        if (parent === null || list.pumping !== source) return
        // Appended, so its position IS the index it arrived at.
        list.rows.push(
            makeRow(list, parent, region.close, list.key(item, at), item, at),
        )
        at += 1
    }
}

export type RowBuilders = {
    // A row's nodes, BUILT in the document the list stands in — handed over by the reconcile
    // rather than found by the row, which is the one place a row's document is decided.
    make: (document: Document, item: unknown, at: number) => Node[]
    // Handed the row's RECORD rather than its nodes: a row it rebuilds (41.10) writes its new
    // first node back there.
    mount: (row: Row, item: unknown, at: number) => Scope
}
