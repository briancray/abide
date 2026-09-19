// THE KEYED-LIST CASES, TIMED IN A REAL ENGINE. CLAUDE.md already carries the rule
// these exist for — "a full reverse cannot tell a minimal keyed reconcile from a
// rebuild; a two-row swap can" — and until now the repo had the rule and no timed arm
// for it: `bench:grid` deliberately has no clock, and `list.test.ts` asserts nodes
// moved. A COUNT IS NOT A COST, and converting one to the other is what this file is.
//
// IN `scripts/` AND BROWSER-ONLY, for the same two reasons the reactive cases are.
// `batch()` refuses a duration whose op touched an emulated DOM (44.18) and it is
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
    REGION_CLOSE,
    REGION_OPEN,
    reconcile,
    Scope,
    updateList,
} from 'abide/runtime'

type Case = {
    name: string
    // What the case is FOR. A benchmark case earns its place by DISTINGUISHING
    // implementations, not by being representative.
    distinguishes: string
    // Rebuilt per rep, because every arm MUTATES the document it was given.
    setup: () => {
        vanilla: () => void
        abide: () => void
        careless: () => void
    }
}

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

/** A `<ul>` holding the region anchors and `count` rendered rows, attached to the document. */
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
            // HYDRATED from the rows `host` rendered, the way a served page's list is.
            const list = listAt(
                a.region as never,
                false,
                (row) => (row as Datum).id,
                (row) => {
                    const item = document.createElement('li')
                    item.setAttribute('data-id', String((row as Datum).id))
                    item.textContent = (row as Datum).label
                    return [item]
                },
                () => new Scope(),
            )
            updateList(list, seed)
            const b = host(seed)
            const c = host(seed)
            const rebuilt = [markup(moved), markup(seed)]

            // EVERY ARM ALTERNATES BETWEEN THE TWO ORDERS, because a rep repeats and an
            // edit does not: applied twice, a relocation is a no-op the second time and
            // the batcher would be timing a reconcile that decides nothing. Both
            // directions are the same shape of edit, so the alternation costs the case
            // nothing and is what makes every rep a real one.
            let side = 0
            let floorSide = 0
            let carelessSide = 0
            return {
                abide: (): void => {
                    const at = side
                    side = 1 - side
                    reconcile(list, orders[at] as Datum[])
                },
                // THE FLOOR: the fewest `insertBefore` calls the edit needs, given the
                // permutation up front. Nothing derives it — knowing the answer is the
                // point, because that is what the reconcile is being priced against.
                vanilla: (): void => {
                    const forward = floorSide === 0
                    floorSide = 1 - floorSide
                    const items = b.list.querySelectorAll('li')
                    if (kind === 'reverse') {
                        for (let at = items.length - 1; at >= 0; at -= 1)
                            b.list.insertBefore(
                                items[at] as HTMLElement,
                                b.region.close,
                            )
                        return
                    }
                    if (kind === 'relocate') {
                        // Out and back: 198 -> 1, then 1 -> 198. One call either way.
                        const from = forward ? ROWS - 2 : 1
                        const to = forward ? 1 : ROWS - 1
                        b.list.insertBefore(
                            items[from] as HTMLElement,
                            (items[to] as HTMLElement) ?? b.region.close,
                        )
                        return
                    }
                    const [low, high] =
                        kind === 'adjacent' ? [0, 1] : [1, ROWS - 2]
                    const first = items[low] as HTMLElement
                    const second = items[high] as HTMLElement
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
            }
        },
    }
}

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
