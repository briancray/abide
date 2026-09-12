// FOUR USE CASES, ONE PER APP BRAND NAMES, and every one of them is a DOM claim about
// the reactive core with no renderer under it. The bindings here are hand-written
// `watch` effects writing nodes, which is what `RENDERER.md` will emit and is not yet
// written — so these measure the graph's cost at the place a page actually pays it.
//
// COUNTS, NOT MILLISECONDS. `bun test` runs against happy-dom, where `appendChild` is
// ~130 ns of JavaScript and a duration describes the emulator (44.11, 44.12). What
// carries across substrates is how many nodes were touched and how many readers woke,
// so that is what is asserted and there is no timing here at all.
//
// THE OP INCLUDES THE SETTLE. Every measured body ends in `flushEffects()`: a write
// that schedules its readers has not finished until they have run, and a body that
// stopped at the write would report zero DOM writes for an op that does them a
// microtask later. Under an eager flush the call is a no-op, so the same body is
// honest either way — which is what lets these gates survive the scheduling change
// they were written to judge.

import { expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import {
    buildRows,
    makeRows,
    orderOf,
    reconcile,
    type Row,
    setLabel,
    setSelected,
} from 'harness/measure/vanilla'
import { memo, state, structural, watch } from '#shared/index.ts'
import { publishWork } from '#shared/reactive/counters.ts'
import { flushEffects } from '#shared/reactive/graph.ts'

publishWork()

const host = (): HTMLElement => {
    const element = document.createElement('ul')
    document.body.appendChild(element)
    return element
}

const show = (name: string, work: Record<string, unknown>): void => {
    const rows = Object.entries(work)
        .filter(([, value]) => typeof value === 'number' && value !== 0)
        .map(([key, value]) => `${key} ${value}`)
    console.log(`  ${name}: ${rows.join(', ')}`)
}

// ---------------------------------------------------------------------------------
// CRM — "a search that holds what each query found". One keystroke, ten thousand
// contacts, forty rows on screen. The op is one write, so this case says nothing
// about scheduling: what it prices is the BINDING — how many readers one write wakes
// and how many nodes they touch — and it is here as the control that a scheduling
// change must leave alone.
// ---------------------------------------------------------------------------------
const CONTACTS = 10_000
const WINDOW = 40

test('CRM: one keystroke over 10,000 contacts touches only the rows whose text moved', () => {
    const contacts = makeRows(CONTACTS)
    const query = state('row 1')
    const matches = memo(() =>
        contacts.filter((row) => row.label.startsWith(query())).slice(0, WINDOW),
    )

    const element = host()
    const labels = buildRows(element, matches().slice(0, WINDOW))
    for (let at = 0; at < labels.length; at += 1) {
        const node = labels[at] as Text
        const index = at
        watch(() => {
            const row = (matches() as Row[])[index]
            setLabel(node, row === undefined ? '' : row.label)
        })
    }

    const abide = measure(() => {
        query.set('row 11')
        flushEffects()
    })

    // The hand-written arm: filter, then write the labels that moved.
    const handRows = makeRows(CONTACTS)
    const handElement = host()
    const handLabels = buildRows(
        handElement,
        handRows.filter((row) => row.label.startsWith('row 1')).slice(0, WINDOW),
    )
    const hand = measure(() => {
        const found = handRows
            .filter((row) => row.label.startsWith('row 11'))
            .slice(0, WINDOW)
        for (let at = 0; at < handLabels.length; at += 1) {
            const row = found[at]
            setLabel(handLabels[at] as Text, row === undefined ? '' : row.label)
        }
    })

    show('abide', abide)
    show('hand', hand)
    expect(abide.dataWrites).toBe(hand.dataWrites)
    expect(abide.elementsMoved).toBe(0)
    expect(abide.nodesCreated).toBe(0)
})

// ---------------------------------------------------------------------------------
// DASHBOARD — "a total that follows its filter". Two hundred metrics land in one tick
// and one tile shows the total. THE FAN-IN CASE: every write reaches the same reader,
// so what this counts is how many times that reader ran for one tick of writes, and
// how many times the tile was written.
// ---------------------------------------------------------------------------------
const METRICS = 200

// REVERT: `scheduleFlush` in `graph.ts` taking the drain itself rather than queueing a
// microtask. REPORTS: 200 data writes and 200 wakes where this asserts 1 and 1 — the
// total tile written once per metric, and the aggregate recomputed over all 200
// metrics each time, which is quadratic in the reader's own cost.
test('DASHBOARD: 200 metrics landing in one tick write the total tile once', () => {
    const metrics: ReturnType<typeof state<number>>[] = []
    for (let at = 0; at < METRICS; at += 1) metrics.push(state(at))
    const total = memo(() => {
        let sum = 0
        for (let at = 0; at < METRICS; at += 1) sum += metrics[at]?.() ?? 0
        return sum
    })
    const tile = document.createTextNode('')
    document.body.appendChild(tile)
    watch(() => {
        setLabel(tile, String(total()))
    })

    const abide = measure(() => {
        for (let at = 0; at < METRICS; at += 1) metrics[at]?.set(at + 1)
        flushEffects()
    })

    // The hand-written arm: write the array, then the total, then the node — once.
    const handMetrics = new Array<number>(METRICS).fill(0)
    const handTile = document.createTextNode('')
    document.body.appendChild(handTile)
    const hand = measure(() => {
        for (let at = 0; at < METRICS; at += 1) handMetrics[at] = at + 1
        let sum = 0
        for (let at = 0; at < METRICS; at += 1) sum += handMetrics[at] as number
        setLabel(handTile, String(sum))
    })

    show('abide', abide)
    show('hand', hand)
    expect(hand.dataWrites).toBe(1)
    expect(abide.dataWrites).toBe(1)
    expect(abide.wakes).toBe(1)
})

// ---------------------------------------------------------------------------------
// LLM CHAT — "a transcript that grows without being rebuilt". Two arrivals shapes, and
// both are owed: a BURST is the case that distinguishes a scheduler, and one token PER
// TICK is the case that catches a scheduler which coalesces an update away.
// ---------------------------------------------------------------------------------
const TOKENS = 1_000

// REVERT: the same one. REPORTS: 1,000 data writes and 1,000 wakes where this asserts
// 1 and 1. The transcript is painted per token rather than per tick, and the hand-
// written arm beside it paints once.
test('CHAT: a thousand tokens in one tick paint the transcript once', () => {
    const token = state('', { tail: 64 })
    const node = document.createTextNode('')
    document.body.appendChild(node)
    watch(() => {
        setLabel(node, token())
    })

    const abide = measure(() => {
        for (let at = 0; at < TOKENS; at += 1) token.set(`token ${at}`)
        flushEffects()
    })

    const handNode = document.createTextNode('')
    document.body.appendChild(handNode)
    const hand = measure(() => {
        let last = ''
        for (let at = 0; at < TOKENS; at += 1) last = `token ${at}`
        setLabel(handNode, last)
    })

    show('abide', abide)
    show('hand', hand)
    expect(hand.dataWrites).toBe(1)
    expect(abide.dataWrites).toBe(1)
    expect(abide.wakes).toBe(1)
})

// THE CONTROL FOR THE CASE ABOVE, and it is owed: a scheduler coalescing per READER
// rather than per tick would report 1 there and 1 here, and would be wrong here. There
// is no revert that fails this one — it passes with the mechanism in and out, which is
// what a control is.
test('CHAT: a thousand tokens one tick apart paint a thousand times', () => {
    const token = state('', { tail: 64 })
    const node = document.createTextNode('')
    document.body.appendChild(node)
    watch(() => {
        setLabel(node, token())
    })

    const abide = measure(() => {
        for (let at = 0; at < TOKENS; at += 1) {
            token.set(`token ${at}`)
            // The tick, spelled as the settle it stands for.
            flushEffects()
        }
    })

    show('abide', abide)
    expect(abide.dataWrites).toBe(TOKENS)
    expect(abide.wakes).toBe(TOKENS)
})

// ---------------------------------------------------------------------------------
// PLAYER — "a now-playing bar and a library that agree". One state, two hundred
// readers. THE FAN-OUT CASE, and the control for the one above it: a scheduler that
// coalesces per READER rather than per TICK would report one write here and be wrong.
// ---------------------------------------------------------------------------------
const READERS = 200

// THE FAN-OUT CONTROL. Two hundred readers of one value are owed a run each, so this
// number must NOT move: it is what says the coalescing is per tick and not per write
// reaching a reader. The equal write beside it is 5.2's cutoff, which is the other way
// a DOM write gets avoided and is unrelated to the schedule.
test('PLAYER: one write reaches every reader once, and an equal write reaches none', () => {
    const playing = state('nothing')
    const nodes: Text[] = []
    for (let at = 0; at < READERS; at += 1) {
        const node = document.createTextNode('')
        document.body.appendChild(node)
        nodes.push(node)
        watch(() => {
            setLabel(node, playing())
        })
    }

    const abide = measure(() => {
        playing.set('a song')
        flushEffects()
    })
    const again = measure(() => {
        playing.set('a song')
        flushEffects()
    })

    show('abide', abide)
    show('equal write', again)
    expect(abide.dataWrites).toBe(READERS)
    expect(abide.wakes).toBe(READERS)
    expect(again.dataWrites).toBe(0)
    expect(again.wakes).toBe(0)
})

// ---------------------------------------------------------------------------------
// PLAYER — "a now-playing bar and a library that agree", at the place that costs: the
// SELECTION in a 500-row table, which is the write whose cost depends on whether a
// rule matches the class it sets.
//
// TWO BINDING SHAPES, and the scheduler cannot tell them apart — this is the case
// where the answer is the graph rather than the tick. Five hundred effects reading the
// shared state all wake, because all of them read a value that moved, and all 500
// touch a `classList`. Put a `memo` between the state and the node and 498 of them
// produce the value they already had, where 5.2 stops the propagation — so the wakes
// stay 500 in the cheap layer and the DOM writes fall to 2.
//
// This is what a compiled slot has to emit, and `RENDERER.md` owes the number: the
// same page, one binding shape apart, is 500 class writes or 2.
// ---------------------------------------------------------------------------------
const TABLE = 500

test('PLAYER: a per-row memo turns 500 class writes into 2', () => {
    const rows = makeRows(TABLE)

    // The naive shape: the row's effect reads the shared state itself.
    const naiveSelected = state(0)
    const naiveHost = host()
    buildRows(naiveHost, rows)
    const naiveItems = Array.from(naiveHost.children)
    for (let at = 0; at < naiveItems.length; at += 1) {
        const item = naiveItems[at] as Element
        const index = at
        watch(() => {
            setSelected(item, naiveSelected() === index)
        })
    }
    const naive = measure(() => {
        naiveSelected.set(1)
        flushEffects()
    })

    // The derived shape: a memo per row, and the effect reads the memo.
    const selected = state(0)
    const element = host()
    buildRows(element, rows)
    const items = Array.from(element.children)
    for (let at = 0; at < items.length; at += 1) {
        const item = items[at] as Element
        const index = at
        const isSelected = memo(() => selected() === index)
        watch(() => {
            setSelected(item, isSelected() as boolean)
        })
    }
    const derived = measure(() => {
        selected.set(1)
        flushEffects()
    })

    // The hand-written arm knows which two rows moved, and touches two.
    const handHost = host()
    buildRows(handHost, rows)
    const handItems = Array.from(handHost.children)
    let handSelected = 0
    const hand = measure(() => {
        setSelected(handItems[handSelected] as Element, false)
        handSelected = 1
        setSelected(handItems[handSelected] as Element, true)
    })

    show('naive (effect reads the state)', naive)
    show('derived (memo per row)', derived)
    show('hand', hand)

    expect(naive.classWrites).toBe(TABLE)
    expect(derived.classWrites).toBe(hand.classWrites)
    expect(hand.classWrites).toBe(2)
    // The cutoff is in the DOM layer, not the graph: every row's memo still recomputes.
    expect(derived.wakes).toBe(2)
})


// ---------------------------------------------------------------------------------
// DASHBOARD — "a metric three tiles want and one load answers", as a CHAIN. Four
// derived values stacked on one source, which is the shape a dashboard column is:
// rows → filtered → totalled → formatted.
//
// THE COUNT IS BODY RUNS PER WRITE, and the number that matters is that it is the
// DEPTH and not two to the depth. A memo notified at CHECK that recomputes
// unconditionally re-runs everything above it whether or not its own answer moved, and
// a diamond then visits a node once per path rather than once — so a k-deep chain runs
// 2^k times while rendering exactly the right value.
//
// The census behind it, taken with every call in the path counted: one write and one
// read through a 1-deep chain is 27 calls and through a 4-deep chain is 75, so a layer
// is ~16 calls and the growth is linear in the depth.
//
// REVERT: `bringUpToDate` recomputing wherever its reader is not clean, instead of
// asking `revalidate` first. REPORTS: 2 runs of the outer body where this asserts 1 —
// the eager push 5.2 forbids, arriving by the read path.
const DEPTH = 4

test('DASHBOARD: a 4-deep chain runs each body once per write, not 2^4 times', () => {
    const source = state(1)
    const runs: number[] = []
    let head = state(0) as unknown as ReturnType<typeof memo<number>>
    let below: () => number = () => source() as number
    for (let at = 0; at < DEPTH; at += 1) {
        const index = at
        const inner = below
        runs.push(0)
        const layer = memo(() => {
            runs[index] = (runs[index] as number) + 1
            return inner() + 1
        })
        head = layer as never
        below = () => layer() as number
    }
    // Warm: the chain has never been read, so the first read runs every body.
    expect(head()).toBe(5)
    for (let at = 0; at < DEPTH; at += 1) expect(runs[at]).toBe(1)

    for (let at = 0; at < DEPTH; at += 1) runs[at] = 0
    source.set(2)
    expect(head()).toBe(6)
    // One run per layer. 2^4 = 16 is what the eager push reports, and 4 is the depth.
    for (let at = 0; at < DEPTH; at += 1) expect(runs[at]).toBe(1)

    // And an identity that does not move stops the walk: writing the same value again
    // runs nothing at all.
    for (let at = 0; at < DEPTH; at += 1) runs[at] = 0
    source.set(2)
    expect(head()).toBe(6)
    for (let at = 0; at < DEPTH; at += 1) expect(runs[at]).toBe(0)
})

// ---------------------------------------------------------------------------------
// LLM CHAT — "a transcript that grows without being rebuilt", as the SCROLLBACK it is:
// sixty-four visible rows over a `tail`, and two hundred chunks arriving one tick
// apart. Every row's text shifts up by one per chunk, so 64 writes per tick is the
// floor and the hand-written arm pays exactly that.
//
// What this catches is a window that REBUILDS: nodes created per tick rather than
// written, which is the difference between a scrollback and a re-render and is
// invisible in the output.
// ---------------------------------------------------------------------------------
const WINDOW_ROWS = 64
const CHUNKS = 200

test('CHAT: a scrollback over tail writes its window and creates nothing', () => {
    const chunk = state('', { tail: WINDOW_ROWS })
    const element = host()
    const rows = buildRows(element, makeRows(WINDOW_ROWS))
    watch(() => {
        // THE VALUE READ IS WHAT SUBSCRIBES, and `tail` is how the window is got.
        // 2.8 makes `s.tail` a CURSOR — replay, then continue live — so a synchronous
        // call to it inside an effect joins no flow: the Terms table has a read as a
        // call to `s` or `s.peek` and nothing else. Written with the tail alone this
        // effect woke ZERO times over two hundred chunks while rendering the first
        // window forever, which is a whole scrollback that never moves.
        chunk()
        const held = [...chunk.tail(WINDOW_ROWS)] as string[]
        for (let at = 0; at < WINDOW_ROWS; at += 1)
            setLabel(rows[at] as Text, held[at] ?? '')
    })

    // Fill the window first, so every tick measured below is a full shift.
    for (let at = 0; at < WINDOW_ROWS; at += 1) {
        chunk.set(`token ${at}`)
        flushEffects()
    }

    const abide = measure(() => {
        for (let at = 0; at < CHUNKS; at += 1) {
            chunk.set(`token ${WINDOW_ROWS + at}`)
            flushEffects()
        }
    })

    // The hand-written arm: a ring of its own, and the same 64 writes per tick.
    const handElement = host()
    const handRows = buildRows(handElement, makeRows(WINDOW_ROWS))
    const held: string[] = []
    for (let at = 0; at < WINDOW_ROWS; at += 1) held.push(`token ${at}`)
    const hand = measure(() => {
        for (let at = 0; at < CHUNKS; at += 1) {
            held.push(`token ${WINDOW_ROWS + at}`)
            if (held.length > WINDOW_ROWS) held.shift()
            for (let row = 0; row < WINDOW_ROWS; row += 1)
                setLabel(handRows[row] as Text, held[row] ?? '')
        }
    })

    show('abide', abide)
    show('hand', hand)
    // Nothing is rebuilt in either arm.
    expect(abide.nodesCreated).toBe(0)
    expect(hand.nodesCreated).toBe(0)
    // One wake per chunk, and the window's worth of writes per wake.
    expect(abide.wakes).toBe(CHUNKS)
    expect(abide.dataWrites).toBe(hand.dataWrites)
})


// ---------------------------------------------------------------------------------
// CRM — "a save that can fail". A field, a message under it, and a write the schema
// refuses. 4.9 has a refused write store nothing and mint no production, so the FIELD's
// binding must not run: the page is right either way — the old value is still on screen —
// and the only thing that says so is the count.
//
// REVERT: `refuse` waking `VALUE` alongside `ERRORED`. REPORTS: 1 write to the field
// where this asserts 0, on every rejected keystroke of every form in the app.
// ---------------------------------------------------------------------------------
test('CRM: a refused save writes the message and leaves the field alone', () => {
    const phone = state('555 0100', {
        schema: (value: unknown) => {
            if (typeof value !== 'string' || value.length < 3)
                throw new Error('too short')
            return value
        },
    })
    const field = document.createTextNode('')
    const message = document.createTextNode('')
    document.body.appendChild(field)
    document.body.appendChild(message)
    watch(() => {
        setLabel(field, phone() as string)
    })
    watch(() => {
        const failed = phone.error()
        setLabel(message, failed === undefined ? '' : 'too short')
    })
    flushEffects()

    const refused = measure(() => {
        phone.set('x')
        flushEffects()
    })
    show('refused write', refused)
    // The message appeared; the field was not touched.
    expect(refused.dataWrites).toBe(1)
    expect(refused.wakes).toBe(1)
    expect(field.data).toBe('555 0100')
    expect(message.data).toBe('too short')

    // And the accepted write that follows clears the message and writes the field —
    // two wakes, because both readers are owed one. Zero here would mean the refusal
    // had left the value channel wedged.
    const accepted = measure(() => {
        phone.set('555 0199')
        flushEffects()
    })
    show('accepted write', accepted)
    expect(accepted.wakes).toBe(2)
    expect(field.data).toBe('555 0199')
    expect(message.data).toBe('')
})

// ---------------------------------------------------------------------------------
// CRM — "a save button that has to know in-flight from first-load". Three bindings over
// one memo: a spinner on `pending`, a "saving…" on `refreshing`, and the record itself.
// 3.4 and 7.5 keep those two apart, and what a page gets wrong is showing the skeleton
// again for a reload it already has data for.
//
// REVERT: `refresh` entering `PENDING` rather than `REFRESHING`. REPORTS: the skeleton
// reader waking on a reload where this asserts it does not, so a filled record blanks
// and refills on every background refresh.
// ---------------------------------------------------------------------------------
test('CRM: a reload reports refreshing and does not wake the skeleton', async () => {
    let landed: (value: string) => void = () => {}
    let loads = 0
    const record = memo(() => {
        loads += 1
        return new Promise<string>((resolve) => {
            landed = resolve
        })
    })

    let skeletonRuns = 0
    let savingRuns = 0
    watch(() => {
        record.pending()
        skeletonRuns += 1
    })
    watch(() => {
        record.refreshing()
        savingRuns += 1
    })
    // The read is what starts the load.
    record()
    flushEffects()
    expect(loads).toBe(1)
    expect(record.pending()).toBe(true)

    const skeletonBefore = skeletonRuns
    landed('Ada Lovelace')
    await Promise.resolve()
    await Promise.resolve()
    flushEffects()
    expect(record()).toBe('Ada Lovelace')
    expect(record.pending()).toBe(false)
    // The skeleton woke for the landing — it has to, that is the spinner coming down.
    expect(skeletonRuns).toBeGreaterThan(skeletonBefore)

    // Now the reload, over a value still being served.
    const skeletonAtReload = skeletonRuns
    const savingAtReload = savingRuns
    record.refresh()
    flushEffects()
    expect(record.refreshing()).toBe(true)
    expect(record.pending()).toBe(false)
    // 7.4 — what is held is still served, so the record's own readers are owed nothing.
    expect(record()).toBe('Ada Lovelace')
    expect(savingRuns).toBeGreaterThan(savingAtReload)
    expect(skeletonRuns).toBe(skeletonAtReload)
})


// ---------------------------------------------------------------------------------
// THE KEYED LIST, which is the op every one of these apps eventually pays for: a media
// library reordered, a dashboard table sorted, a CRM list re-sorted by a column. The
// reconcile itself is `RENDERER.md`'s and is not written, so the ALGORITHM is the
// hand-written one in `harness/measure/vanilla` and both arms call it — what differs is
// who decides to run it and over what.
//
// TWO CASES AND BOTH ARE OWED. A two-row swap is the only one that can PRICE a
// reconcile: a full reverse cannot tell a minimal one from a rebuild. And the full
// reverse is the only one that can catch a transposition that leaves both ends right,
// which is why the order is compared WHOLE and not at its edges.
// ---------------------------------------------------------------------------------
const LIST = 500

function mountList(count: number): {
    element: HTMLElement
    nodes: Map<number, Element>
    ids: number[]
} {
    const rows = makeRows(count)
    const element = host()
    buildRows(element, rows)
    const nodes = new Map<number, Element>()
    const ids: number[] = []
    let at = 0
    for (let child = element.firstElementChild; child !== null; child = child.nextElementSibling) {
        const row = rows[at] as Row
        nodes.set(row.id, child)
        child.setAttribute('data-id', String(row.id))
        ids.push(row.id)
        at += 1
    }
    return { element, nodes, ids }
}

const keyOf = (element: Element): number =>
    Number(element.getAttribute('data-id'))

test('LIST: a two-row swap driven by the graph moves two elements, not five hundred', () => {
    const { element, nodes, ids } = mountList(LIST)
    const order = state(ids.slice())
    watch(() => {
        reconcile(element, nodes, order() as number[])
    })
    flushEffects()

    const swapped = ids.slice()
    const first = swapped[1] as number
    swapped[1] = swapped[3] as number
    swapped[3] = first

    const abide = measure(() => {
        order.set(swapped)
        flushEffects()
    })

    // The hand-written arm: the same reconcile, called directly.
    const hand0 = mountList(LIST)
    const handSwapped = hand0.ids.slice()
    const handFirst = handSwapped[1] as number
    handSwapped[1] = handSwapped[3] as number
    handSwapped[3] = handFirst
    const hand = measure(() => {
        reconcile(hand0.element, hand0.nodes, handSwapped)
    })

    show('abide', abide)
    show('hand', hand)
    // THE REFLOW ROW, and the only one `RENDERER.md` gates. Two elements, at 500 rows.
    expect(abide.elementsMoved).toBe(2)
    expect(abide.elementsMoved).toBe(hand.elementsMoved)
    expect(abide.nodesCreated).toBe(0)
    expect(abide.wakes).toBe(1)
    // …and the list really is in the new order, compared whole.
    expect(orderOf(element, keyOf)).toEqual(swapped)
})

test('LIST: at ten thousand rows the op scales with the DISTANCE, not the list', () => {
    const BIG = 10_000
    // Near neighbours, ten thousand rows in: the list is 20x the case above and the op
    // is the same size, which is the claim `elementsMoved` exists to make.
    const near = mountList(BIG)
    const nearOrder = state(near.ids.slice())
    watch(() => {
        reconcile(near.element, near.nodes, nearOrder() as number[])
    })
    flushEffects()
    const nearSwap = near.ids.slice()
    const held = nearSwap[9_000] as number
    nearSwap[9_000] = nearSwap[9_002] as number
    nearSwap[9_002] = held
    const nearby = measure(() => {
        nearOrder.set(nearSwap)
        flushEffects()
    })
    show('swap two neighbours at n=10,000', nearby)
    expect(nearby.elementsMoved).toBe(2)
    expect(nearby.wakes).toBe(1)
    expect(orderOf(near.element, keyOf)).toEqual(nearSwap)

    // ACROSS THE LIST, and this prices the hand-written reconcile rather than the graph.
    // Insert-into-place walks the cursor, so a node moved 8,990 positions leaves the one
    // it displaced standing in the way of everything between — the cost is the DISTANCE.
    // A reconcile that tracked positions would move two. Both arms report the same
    // number, which is the part that is about abide: driving it from the graph adds no
    // DOM work over calling it by hand.
    const far = mountList(BIG)
    const farOrder = state(far.ids.slice())
    watch(() => {
        reconcile(far.element, far.nodes, farOrder() as number[])
    })
    flushEffects()
    const farSwap = far.ids.slice()
    const first = farSwap[10] as number
    farSwap[10] = farSwap[9_000] as number
    farSwap[9_000] = first
    const abide = measure(() => {
        farOrder.set(farSwap)
        flushEffects()
    })

    const hand0 = mountList(BIG)
    const handSwap = hand0.ids.slice()
    const handFirst = handSwap[10] as number
    handSwap[10] = handSwap[9_000] as number
    handSwap[9_000] = handFirst
    const hand = measure(() => {
        reconcile(hand0.element, hand0.nodes, handSwap)
    })

    show('swap across the list, abide', abide)
    show('swap across the list, hand', hand)
    expect(abide.elementsMoved).toBe(hand.elementsMoved)
    expect(abide.wakes).toBe(1)
    expect(orderOf(far.element, keyOf)).toEqual(farSwap)
})

test('LIST: a full reverse and a rotation land the whole order, not just its ends', () => {
    const { element, nodes, ids } = mountList(LIST)
    const order = state(ids.slice())
    watch(() => {
        reconcile(element, nodes, order() as number[])
    })
    flushEffects()

    const reversed = ids.slice().reverse()
    const reverse = measure(() => {
        order.set(reversed)
        flushEffects()
    })
    show('reverse', reverse)
    expect(orderOf(element, keyOf)).toEqual(reversed)
    // The reverse is what PRICES nothing and CATCHES everything: n-1 moves either way,
    // so the number is reported and the order is what is asserted.
    expect(reverse.elementsMoved).toBe(LIST - 1)

    // A rotation, which a prefix/suffix guard gets wrong in a way a reverse does not:
    // nothing is where it was and both ends moved.
    const rotated = [...reversed.slice(7), ...reversed.slice(0, 7)]
    const rotate = measure(() => {
        order.set(rotated)
        flushEffects()
    })
    show('rotate', rotate)
    expect(orderOf(element, keyOf)).toEqual(rotated)

    // And a write of the SAME order moves nothing at all — 5.2 reaching the DOM.
    const again = measure(() => {
        order.set(rotated.slice())
        flushEffects()
    })
    show('same order again', again)
    expect(again.elementsMoved).toBe(0)
    expect(again.wakes).toBe(0)
})


// ---------------------------------------------------------------------------------
// PLAYER — "a playlist mutated in place", which is what `s.patch` is for and the one
// write in the design that is NOT gated by `identity` (5.21, D121). Three writes to one
// 500-row list, and the three different things they do:
//
//   patch that changes a row   — the graph wakes, one node is written
//   patch that changes nothing — the graph STILL wakes, and no node is written
//   set of an equal array      — the graph does not wake at all
//
// The middle one is the cost of the escape hatch, stated: a patch has no incoming value
// to compare, so it cannot be swallowed, and what stops the DOM write is the derived
// row's own cutoff rather than the state's. An author who reaches for `patch` to skip
// the structural walk is also giving up the write-side cutoff, and this is the count
// that says so.
// ---------------------------------------------------------------------------------
test('PLAYER: a patch always wakes the graph, and the row cutoff stops the DOM', () => {
    const tracks = state(makeRows(LIST))
    const element = host()
    buildRows(element, tracks() as Row[])
    const items = Array.from(element.children)
    const labels: Text[] = []
    for (const item of items) labels.push(item.firstChild as Text)
    let rowRuns = 0
    for (let at = 0; at < items.length; at += 1) {
        const index = at
        const node = labels[at] as Text
        const label = memo(() => {
            rowRuns += 1
            return ((tracks() as Row[])[index] as Row).label
        })
        watch(() => {
            setLabel(node, label() as string)
        })
    }
    flushEffects()

    rowRuns = 0
    const changed = measure(() => {
        tracks.patch((held) => {
            ;((held as Row[])[7] as Row).label = 'Kind of Blue'
        })
        flushEffects()
    })
    show('patch one row of 500', changed)
    expect(changed.dataWrites).toBe(1)
    expect(changed.wakes).toBe(1)
    // Every row's memo recomputed — that is the cheap layer — and one identity moved.
    expect(rowRuns).toBe(LIST)
    expect((labels[7] as Text).data).toBe('Kind of Blue')

    rowRuns = 0
    const same = measure(() => {
        tracks.patch((held) => {
            ;((held as Row[])[7] as Row).label = 'Kind of Blue'
        })
        flushEffects()
    })
    show('patch that changes nothing', same)
    // 5.21 — not gated, so the graph woke and every row recomputed…
    expect(rowRuns).toBe(LIST)
    // …and nothing reached the document.
    expect(same.dataWrites).toBe(0)
    expect(same.wakes).toBe(0)

    rowRuns = 0
    const replaced = measure(() => {
        tracks.set((tracks() as Row[]).map((row) => ({ ...row })))
        flushEffects()
    })
    show('set an equal array', replaced)
    // The state's own gate swallowed it, so the cheap layer did not even run.
    expect(rowRuns).toBe(0)
    expect(replaced.dataWrites).toBe(0)
    expect(replaced.wakes).toBe(0)
})

// ---------------------------------------------------------------------------------
// CRM — "a phone stored raw and shown formatted". 4.7 has `transform` run once per
// MATERIALISATION, and what that buys is the thing a page does most: read. Formatting in
// the binding instead runs per read, which is per row per frame, and the output is
// identical either way.
//
// REVERT: run the transform on the read rather than on the write. REPORTS: 1 run where
// this asserts it stays at 1 after a hundred reads — and 100 where a table of a hundred
// rows reads it once each.
// ---------------------------------------------------------------------------------
test('CRM: a transform runs once per write, not once per read', () => {
    let formats = 0
    // `state<string>` and not the inferred literal: `state('5550100', …)` narrows
    // `Accepted` to that one string, and the second write then does not typecheck.
    const phone = state<string>('5550100', {
        transform: (raw: string) => {
            formats += 1
            return `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`
        },
    })
    const node = document.createTextNode('')
    document.body.appendChild(node)
    watch(() => {
        setLabel(node, phone() as string)
    })
    flushEffects()
    // The initial value is a write like any other, so it has been through the transform.
    expect(formats).toBe(1)
    expect(node.data).toBe('(555) 010-0')

    formats = 0
    const read = measure(() => {
        for (let at = 0; at < 100; at += 1) phone()
    })
    show('a hundred reads', read)
    expect(formats).toBe(0)
    expect(read.dataWrites).toBe(0)

    formats = 0
    const write = measure(() => {
        phone.set('5550199')
        flushEffects()
    })
    show('one write', write)
    expect(formats).toBe(1)
    expect(write.dataWrites).toBe(1)
    expect(node.data).toBe('(555) 019-9')

    // AND THE ORDER MATTERS: 4.6 puts the transform in front of storage, so a repeated
    // write pays for it and is then swallowed by the gate. The transform is not a cache.
    formats = 0
    const again = measure(() => {
        phone.set('5550199')
        flushEffects()
    })
    show('the same write again', again)
    expect(formats).toBe(1)
    expect(again.wakes).toBe(0)
    expect(again.dataWrites).toBe(0)
})


// ---------------------------------------------------------------------------------
// WHAT THE DUPLICATE GATE DOES TO A ROW WITH COMPUTED READS, which is a shape nobody
// would predict from the clause: 5.4's default walks own enumerable properties, and an
// ACCESSOR is one. So the compare RUNS the author's computes — every one of them, on
// every write — and then answers correctly.
//
// A class instance is refused at the prototype check instead (5.6: it cannot decide), so
// no accessor on a prototype is ever invoked and the answer is always "not equal". The
// two shapes are therefore opposite in both respects, and which one an app has is
// decided by whether its rows are object literals or instances.
//
// Measured beside this: 20 rows of depth 11 built as literals with one getter each
// invoked 440 getters per compare. With `identity` declared the same write is 0.13 µs
// against 21 µs, so on this shape the gate is ~99% of the write.
// ---------------------------------------------------------------------------------
test('the structural gate runs an accessor, and refuses a class instance', () => {
    let computes = 0
    const literal = (level: number): Record<string, unknown> => ({
        level,
        get total() {
            computes += 1
            return level * 2
        },
    })
    const first = [literal(1), literal(2)]
    const second = [literal(1), literal(2)]
    computes = 0
    expect(structural(first, second)).toBe(true)
    // Two rows, one accessor each, both sides read: four computes for one compare.
    expect(computes).toBe(4)

    class Row {
        level: number
        constructor(level: number) {
            this.level = level
        }
        get total(): number {
            computes += 1
            return this.level * 2
        }
    }
    computes = 0
    // 5.6 — a class instance is a shape it cannot decide about, so the walk stops at the
    // prototype and the accessor is never reached.
    expect(structural([new Row(1)], [new Row(1)])).toBe(false)
    expect(computes).toBe(0)

    // The consequence for a page, in the only terms that matter: a literal row dedupes
    // and pays the computes; an instance row never dedupes and pays none.
    let literalWakes = 0
    const literals = state(first as unknown)
    watch(() => {
        literals()
        literalWakes += 1
    })
    flushEffects()
    literals.set(second as unknown)
    flushEffects()
    expect(literalWakes).toBe(1)

    let instanceWakes = 0
    const instances = state([new Row(1)] as unknown)
    watch(() => {
        instances()
        instanceWakes += 1
    })
    flushEffects()
    instances.set([new Row(1)] as unknown)
    flushEffects()
    expect(instanceWakes).toBe(2)
})
