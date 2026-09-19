import { listOf } from '#shared/listOf.ts'
import { warnMismatch } from './Mismatch.ts'
import {
    dropRow,
    makeRow,
    type Row,
    reconcile,
    rowOf,
    rowsIn,
} from './reconcile.ts'
import type { Region } from './regionAt.ts'
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
    // 41.16 — once for the block, not once a reconcile.
    warned: boolean
    // WHETHER THE ROWS ARE STILL THE SERVER'S. The first update HYDRATES them rather than
    // reconciling, and clears this.
    hydrating: boolean
    // Whether each row carries its own anchor — a body with several top-level nodes.
    anchored: boolean
    key: (item: unknown, at: number) => unknown
    make: (item: unknown, at: number) => Node[]
    mount: (nodes: Node[], item: unknown, at: number) => Scope

    constructor(
        region: Region,
        rows: Row[],
        key: (item: unknown, at: number) => unknown,
        make: (item: unknown, at: number) => Node[],
        mount: (nodes: Node[], item: unknown, at: number) => Scope,
    ) {
        this.region = region
        this.rows = rows
        this.pumping = null
        this.warned = false
        this.hydrating = false
        this.anchored = false
        this.key = key
        this.make = make
        this.mount = mount
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
    make: (item: unknown, at: number) => Node[],
    mount: (nodes: Node[], item: unknown, at: number) => Scope,
): List {
    const list = new List(region, [], key, make, mount)
    list.hydrating = true
    list.anchored = anchored
    return list
}

// HYDRATION, NOT RENDERING. The rows are already there; wiring them is all that is left. 41.3 — an
// async subject rendered no rows, so it finds none here.
function hydrate(list: List, items: unknown[]): void {
    const found = rowsIn(list.region, list.anchored)
    for (let at = 0; at < found.length; at += 1) {
        const item = items[at]
        list.rows.push(
            rowOf(list, list.key(item, at), item, found[at] as Node[], at),
        )
    }
}

// 32.16 — AN ARRAY RECONCILES AND AN ASYNC SUBJECT APPENDS AS ITEMS ARRIVE. There is no list to
// diff an async subject against: the items are not all there, and the arrival of one says nothing
// about the ones behind it.
export function updateList(list: List, subject: unknown): void {
    const items = listOf(subject)
    const hydrating = list.hydrating
    list.hydrating = false
    if (!Array.isArray(items)) {
        appendRows(list, items)
        return
    }
    if (hydrating) {
        hydrate(list, items)
        return
    }
    list.pumping = null
    reconcile(list, items)
}

// 41.3 IS THE SERVER'S HALF OF 32.16 — the render is not held for an unfinished stream, so an
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
        console.warn('abide:hydrate', thrown)
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
