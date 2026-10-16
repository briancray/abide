// THE KEYED-LIST CASES, TIMED IN A REAL ENGINE. CLAUDE.md already carries the rule
// these exist for — "a full reverse cannot tell a minimal keyed reconcile from a
// rebuild; a two-row swap can" — and until now the repo had the rule and no timed arm
// for it: `bench:grid` deliberately has no clock, and `list.test.ts` asserts nodes
// moved. A COUNT IS NOT A COST, and converting one to the other is what this file is.
//
// IN `scripts/` AND BROWSER-ONLY, for the same two reasons the reactive cases are.
// `batch()` refuses a duration whose op touched an emulated DOM (43.22) and it is
// right to: a reorder in happy-dom is a fact about happy-dom, because only a real
// engine puts the moved element in a reflow. So there is no bun-side entry here —
// these run through `e2e/list.spec.ts` and nowhere else.
//
// THREE ARMS, NOT TWO. The careful hand-written arm is the minimum `insertBefore`
// calls the edit needs, which prices what the reconcile COSTS. The careless arm is an
// `innerHTML` rebuild, which is what the same edit looks like written the obvious way,
// and prices what it BUYS. Quoting only the first is quoting the bill with no receipt.

import {
    listAt,
    noUpdate,
    REGION_CLOSE,
    REGION_OPEN,
    Scope,
    updateList,
} from '@abide/abide/runtime'

type Case = {
    name: string
    /**
     * What the case is FOR.
     *
     * A benchmark case earns its place by DISTINGUISHING implementations, not by being
     * representative.
     */
    distinguishes: string
    /** Builds the three arms over fresh hosts; every arm MUTATES the document it was given. */
    setup: () => {
        vanilla: () => void
        abide: () => void
        careless: () => void
        /**
         * Runs each arm once under a `MutationObserver` and returns the nodes it moved, created
         * and dropped — the counting pass `batch()` is handed as `work`, apart from the timing.
         */
        work: () => Record<ArmName, Record<string, number>>
        /**
         * Each host's row order against the order that arm last wrote, one line per host that
         * disagrees. The full reverse is owed for CORRECTNESS, and a timing never looks.
         */
        verify: () => string[]
    }
}

type ArmName = 'vanilla' | 'abide' | 'careless'

type Datum = { id: number; label: string }

const ROWS = 200

function data(count: number): Datum[] {
    const out: Datum[] = []
    for (let at = 0; at < count; at += 1)
        out.push({ id: at, label: `row ${at}` })
    return out
}

function markup(rows: Datum[]): string {
    let out = ''
    for (let at = 0; at < rows.length; at += 1)
        out += `<li data-id="${(rows[at] as Datum).id}">${(rows[at] as Datum).label}</li>`
    return out
}

/** A `<ul>` holding the region anchors and `rows` rendered, attached to the document. */
function host(rows: Datum[]): {
    list: HTMLElement
    region: { open: Comment; close: Comment }
} {
    const list = document.createElement('ul')
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    list.append(open)
    for (let at = 0; at < rows.length; at += 1) {
        const item = document.createElement('li')
        const row = rows[at] as Datum
        item.setAttribute('data-id', String(row.id))
        item.textContent = row.label
        list.append(item)
    }
    list.append(close)
    // ATTACHED, and that is the measurement. A detached host is never laid out, so a
    // move costs the JS and none of the reflow — which is the 25x between moving a
    // comment and moving an element that CLAUDE.md prices.
    document.body.append(list)
    return { list, region: { open, close } }
}

/** The edit, as an index permutation over the seed order. */
function permutation(
    kind: 'adjacent' | 'distant' | 'relocate' | 'reverse',
): number[] {
    const order: number[] = []
    for (let at = 0; at < ROWS; at += 1) order.push(at)
    if (kind === 'reverse') return order.reverse()
    if (kind === 'adjacent') {
        order[0] = 1
        order[1] = 0
        return order
    }
    if (kind === 'distant') {
        order[1] = ROWS - 2
        order[ROWS - 2] = 1
        return order
    }
    // One row travels, which is ONE `insertBefore` by hand and the case a reconcile
    // that brackets its changes gets wrong — `firstChanged`/`lastChanged` say nothing
    // about the middle, so a relocation reads as a 197-row rewrite.
    const moved = order.splice(ROWS - 2, 1)[0] as number
    order.splice(1, 0, moved)
    return order
}

function listCase(
    name: string,
    distinguishes: string,
    kind: 'adjacent' | 'distant' | 'relocate' | 'reverse',
): Case {
    return {
        name,
        distinguishes,
        setup: () => {
            const seed = data(ROWS)
            const order = permutation(kind)
            const moved: Datum[] = []
            for (let at = 0; at < order.length; at += 1)
                moved.push(seed[order[at] as number] as Datum)
            const orders: Datum[][] = [moved, seed]

            const a = host(seed)
            const builders = {
                make: (made: Document, row: { data: unknown }): Node[] => {
                    const item = made.createElement('li')
                    const datum = row.data as Datum
                    item.setAttribute('data-id', String(datum.id))
                    item.textContent = datum.label
                    return [item]
                },
                mount: (): Scope => new Scope(),
                update: noUpdate,
            }
            // HYDRATED from the rows `host` rendered, the way a served page's list is.
            const list = listAt(
                a.region as never,
                false,
                (row) => (row as Datum).id,
                () => builders,
            )
            updateList(list, seed)
            const b = host(seed)
            const c = host(seed)
            const rebuilt = [markup(moved), markup(seed)]
            // HELD FROM SETUP, so the floor pays the moves and nothing else — a
            // `querySelectorAll` over 200 rows per op was a cost the reconcile it is
            // priced against does not pay. Indexed by seed position; the arm knows the
            // permutation, so it never has to read the order back.
            const seedNodes: HTMLElement[] = []
            for (
                let node = b.region.open.nextSibling;
                node !== b.region.close;
                node = (node as ChildNode).nextSibling
            )
                seedNodes.push(node as HTMLElement)
            const reversedNodes = seedNodes.slice().reverse()

            // EVERY ARM ALTERNATES BETWEEN THE TWO ORDERS, because a rep repeats and an
            // edit does not: applied twice, a relocation is a no-op the second time and
            // the batcher would be timing a reconcile that decides nothing. Both
            // directions are the same shape of edit, so the alternation costs the case
            // nothing and is what makes every rep a real one.
            let side = 0
            let floorSide = 0
            let carelessSide = 0
            const arms = {
                abide: (): void => {
                    const at = side
                    side = 1 - side
                    updateList(list, orders[at] as Datum[])
                },
                // THE FLOOR: the fewest `insertBefore` calls the edit needs, given the
                // permutation up front. Nothing derives it — knowing the answer is the
                // point, because that is what the reconcile is being priced against.
                vanilla: (): void => {
                    const forward = floorSide === 0
                    floorSide = 1 - floorSide
                    if (kind === 'reverse') {
                        const current = forward ? seedNodes : reversedNodes
                        for (let at = current.length - 1; at >= 0; at -= 1)
                            b.list.insertBefore(
                                current[at] as HTMLElement,
                                b.region.close,
                            )
                        return
                    }
                    if (kind === 'relocate') {
                        // Out and back: 198 -> 1, then 1 -> 198. One call either way.
                        b.list.insertBefore(
                            seedNodes[ROWS - 2] as HTMLElement,
                            seedNodes[forward ? 1 : ROWS - 1] as HTMLElement,
                        )
                        return
                    }
                    const [low, high] =
                        kind === 'adjacent' ? [0, 1] : [1, ROWS - 2]
                    const first = seedNodes[forward ? low : high] as HTMLElement
                    const second = seedNodes[
                        forward ? high : low
                    ] as HTMLElement
                    // ADJACENT IS ONE MOVE: the second call of a general swap would put
                    // `first` back where it already is, which the DOM still records.
                    if (kind === 'adjacent') {
                        b.list.insertBefore(second, first)
                        return
                    }
                    const after = second.nextSibling
                    b.list.insertBefore(second, first)
                    b.list.insertBefore(first, after)
                },
                // The version written the obvious way: throw the rows away and write
                // the markup again. Correct output, every node replaced.
                careless: (): void => {
                    const at = carelessSide
                    carelessSide = 1 - carelessSide
                    const open = c.region.open
                    while (
                        open.nextSibling !== null &&
                        open.nextSibling !== c.region.close
                    )
                        (open.nextSibling as ChildNode).remove()
                    const template = document.createElement('template')
                    template.innerHTML = rebuilt[at] as string
                    c.list.insertBefore(template.content, c.region.close)
                },
                work: () => ({
                    vanilla: observed(b.list, arms.vanilla),
                    abide: observed(a.list, arms.abide),
                    careless: observed(c.list, arms.careless),
                }),
                verify: () => {
                    // The side each arm flips TO is the one it writes next, so the
                    // order it last wrote is the other one.
                    const wrong: string[] = []
                    const hosts: [ArmName, HTMLElement, number][] = [
                        ['abide', a.list, side],
                        ['vanilla', b.list, floorSide],
                        ['careless', c.list, carelessSide],
                    ]
                    for (const [name, list, next] of hosts) {
                        const expected = idsOf(orders[1 - next] as Datum[])
                        const actual = idsInDocument(list)
                        if (actual !== expected)
                            wrong.push(
                                `${name}: ${actual.slice(0, 60)}… where ${expected.slice(0, 60)}…`,
                            )
                    }
                    return wrong
                },
            }
            return arms
        },
    }
}

/** The ids a list of rows renders, comma-joined. */
function idsOf(rows: Datum[]): string {
    let out = ''
    for (let at = 0; at < rows.length; at += 1)
        out += `${(rows[at] as Datum).id},`
    return out
}

/** The ids of the `<li>` rows a host holds, in document order, comma-joined. */
function idsInDocument(list: HTMLElement): string {
    let out = ''
    for (let node = list.firstChild; node !== null; node = node.nextSibling)
        if (node.nodeType === 1)
            out += `${(node as Element).getAttribute('data-id')},`
    return out
}

/**
 * Runs `op` once and counts what it did to `list`'s children.
 *
 * A node removed and inserted again in the one op MOVED; inserted alone it was CREATED; removed
 * alone it was DROPPED. `takeRecords` is synchronous, so the op is counted before anything else
 * runs.
 */
function observed(list: HTMLElement, op: () => void): Record<string, number> {
    const observer = new MutationObserver(() => {})
    observer.observe(list, { childList: true })
    op()
    const records = observer.takeRecords()
    observer.disconnect()
    const left = new Set<Node>()
    let nodesMoved = 0
    let nodesCreated = 0
    for (const record of records) {
        for (const node of record.removedNodes) left.add(node)
        for (const node of record.addedNodes)
            if (left.delete(node)) nodesMoved += 1
            else nodesCreated += 1
    }
    return { nodesMoved, nodesCreated, nodesDropped: left.size }
}

/** The four keyed-reorder cases, from the distinguishing swap to the full reverse. */
export const listCases = (): Case[] => [
    listCase(
        'two adjacent rows swap, 200 keyed rows',
        'a minimal keyed reconcile from a rebuild — the distinguishing case for COST, and the one a full reverse cannot make',
        'adjacent',
    ),
    listCase(
        'two distant rows swap, 200 keyed rows',
        'two changed ranges rather than one — a reconcile that brackets its changes reads the whole middle as changed',
        'distant',
    ),
    listCase(
        'one row travels 197 places, 200 keyed rows',
        'the relocation floor — ONE insertBefore by hand, and the case a bracketing reconcile turns into a 197-row rewrite',
        'relocate',
    ),
    listCase(
        'a full reverse of 200 keyed rows',
        'useless for pricing and owed anyway — it is what catches a transposition that corrupts every reorder a two-row swap reports clean',
        'reverse',
    ),
]

export type { Case }
