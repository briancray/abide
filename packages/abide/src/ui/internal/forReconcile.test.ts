// `{#for}` KEYED RECONCILE — DOM ORDER UNDER ARBITRARY LIST MUTATION.
//
// The reorder pass leaves the longest already-ascending run of survivors untouched and moves only the
// rest, which is the minimum number of moves that reaches the target order (`increasingSubsequence` in
// runtime.ts). That is a real algorithm with real off-by-one surface, and the failure mode is not a
// throw — it is a list that renders in the WRONG ORDER, which every existing `{#for}` test would miss
// because they all mutate in one direction.
//
// So this is a fuzz: a deterministic PRNG drives swaps, removals, insertions, reversals, shuffles and
// single-item moves over keyed lists, and after every single mutation the rendered `<li>` order must
// equal the source list exactly. The seed is fixed, so a failure reproduces.

import { expect, test } from 'bun:test'
import { state } from '../../shared/state.ts'
import { loadEmitted } from './emit.ts'

const SOURCE = '<ul>{#for n of items() by n}<li>{n}</li>{/for}</ul>'

// Let the reactive scheduler's queued microtask land the DOM patch before reading the DOM.
async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

function renderedOrder(host: HTMLElement): number[] {
    const out: number[] = []
    for (const row of host.querySelectorAll('li')) out.push(Number(row.textContent))
    return out
}

test('a keyed {#for} renders the exact source order after arbitrary mutation', async () => {
    const mod = await loadEmitted(SOURCE)

    // Deterministic PRNG — a failing case must be reproducible, so no Math.random here.
    let seed = 12345
    const next = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
    }
    const pick = (bound: number): number => Math.floor(next() * bound)

    let mutations = 0
    for (let trial = 0; trial < 200; trial++) {
        let list = Array.from({ length: 1 + pick(12) }, (_, i) => i)
        const cell = state(list)
        const host = document.createElement('div')
        const cleanup = mod.mount(host, { items: cell })
        await flush()
        expect(renderedOrder(host)).toEqual(list)

        for (let step = 0; step < 12; step++) {
            const draft = [...list]
            const op = pick(6)
            if (op === 0 && draft.length > 1) {
                const a = pick(draft.length)
                const b = pick(draft.length)
                const held = draft[a] as number
                draft[a] = draft[b] as number
                draft[b] = held
            } else if (op === 1 && draft.length > 0) {
                draft.splice(pick(draft.length), 1)
            } else if (op === 2) {
                // A key never seen before, so it must be built rather than reused.
                draft.splice(pick(draft.length + 1), 0, 1000 + trial * 100 + step)
            } else if (op === 3) {
                draft.reverse()
            } else if (op === 4) {
                for (let i = draft.length - 1; i > 0; i--) {
                    const j = pick(i + 1)
                    const held = draft[i] as number
                    draft[i] = draft[j] as number
                    draft[j] = held
                }
            } else if (draft.length > 1) {
                const moved = draft.splice(pick(draft.length), 1)[0] as number
                draft.splice(pick(draft.length + 1), 0, moved)
            }

            list = draft
            cell.set(list)
            await flush()
            mutations++
            expect(renderedOrder(host)).toEqual(list)
        }
        cleanup()
    }

    // Guard the guard: if the corpus ever stops actually mutating, the assertions above pass vacuously.
    expect(mutations).toBe(2400)
})

// The fuzz above keys each row BY ITS OWN VALUE, so it can never produce the commonest reactive update
// there is: same keys, different values. That is the shape `reconcile`'s fast path claims — no item
// enters, leaves or moves, so it skips the whole diff and only hands each item its new value. If that
// path ever stopped writing the value through, every test above would still pass.
test('a keyed {#for} updates values in place when the keys are unchanged', async () => {
    const mod = await loadEmitted(
        '<ul>{#for row of rows() by row.id}<li>{row.text}</li>{/for}</ul>',
    )
    const rows = [
        { id: 1, text: 'a' },
        { id: 2, text: 'b' },
        { id: 3, text: 'c' },
    ]
    const cell = state(rows)
    const host = document.createElement('div')
    const cleanup = mod.mount(host, { rows: cell })
    await flush()
    const text = (): string[] => {
        const out: string[] = []
        for (const row of host.querySelectorAll('li')) out.push(row.textContent ?? '')
        return out
    }
    expect(text()).toEqual(['a', 'b', 'c'])

    // Same ids in the same order — the fast path — with two of the three values changed.
    const painted = host.querySelectorAll('li')[1]
    cell.set([
        { id: 1, text: 'A' },
        { id: 2, text: 'b' },
        { id: 3, text: 'C' },
    ])
    await flush()
    expect(text()).toEqual(['A', 'b', 'C'])
    // Updated IN PLACE: the node is the same one, not a rebuilt row.
    expect(host.querySelectorAll('li')[1]).toBe(painted)

    // A key change on the same length must fall through to the real diff, not the fast path.
    cell.set([
        { id: 1, text: 'A' },
        { id: 9, text: 'nine' },
        { id: 3, text: 'C' },
    ])
    await flush()
    expect(text()).toEqual(['A', 'nine', 'C'])
    cleanup()
})

// The fuzz above cannot catch a reorder that is merely WASTEFUL — moving every row still lands the
// right order, so a subsequence solve that silently degenerates to "nothing is in place" passes it
// clean. (It did, once.) This pins the property that actually matters: the number of rows the DOM
// touches has to track the size of the CHANGE, not the size of the list.
test('a keyed {#for} moves only the rows that actually changed place', async () => {
    const mod = await loadEmitted(SOURCE)
    const size = 200

    // Rows relocated during one reconcile, counted off the DOM itself: a move re-inserts the row's
    // nodes, so each relocated row shows up as an addition record naming its `<li>`.
    const movedRows = async (mutate: (list: number[]) => number[]): Promise<number> => {
        const list = Array.from({ length: size }, (_, i) => i)
        const cell = state(list)
        const host = document.createElement('div')
        const cleanup = mod.mount(host, { items: cell })
        await flush()

        const target = host.querySelector('ul')
        if (target === null) throw new Error('the list did not mount')
        let moved = 0
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if ((node as Element).tagName === 'LI') moved++
                }
            }
        })
        observer.observe(target, { childList: true })
        cell.set(mutate([...list]))
        await flush()
        observer.takeRecords()
        observer.disconnect()
        cleanup()
        return moved
    }

    // Exchanging two rows is two relocations. The old reorder cascaded from the first row it moved and
    // relocated nearly the whole list, which cost the same as reversing it.
    const swapped = await movedRows((list) => {
        const held = list[1] as number
        list[1] = list[198] as number
        list[198] = held
        return list
    })
    expect(swapped).toBeLessThanOrEqual(4)

    // Dropping a row relocates nothing at all — every survivor keeps its relative order.
    const removed = await movedRows((list) => {
        list.splice(100, 1)
        return list
    })
    expect(removed).toBe(0)

    // Moving one row to the front relocates that row, not the 199 it displaces.
    const relocated = await movedRows((list) => {
        const moved = list.splice(150, 1)[0] as number
        list.unshift(moved)
        return list
    })
    expect(relocated).toBeLessThanOrEqual(4)

    // A full reverse genuinely has to move nearly everything — proof the counter is measuring, and not
    // just returning zero because the observer is misconfigured.
    const reversed = await movedRows((list) => list.reverse())
    expect(reversed).toBeGreaterThan(size / 2)
})
