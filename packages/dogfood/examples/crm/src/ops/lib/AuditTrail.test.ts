import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import AuditTrail from './AuditTrail.abide'

const list = () => document.querySelector('[role=list]') as HTMLElement
const rows = () => [...document.querySelectorAll('[role=listitem]')]
const positions = () =>
    rows().map((row) => Number(row.getAttribute('aria-posinset')))
function scrollTo(top: number) {
    list().scrollTop = top
    list().dispatchEvent(new Event('scroll'))
    flushSync()
}

// 51.65 — ONLY THE ROWS IN VIEW, AND FIVE PAST, ARE MADE, each saying where it stands in the whole
// trail. THE REVERT: render `AUDIT_TRAIL` whole, and 5,000 rows are made where 17 are due.
test('only the changes in view, and five past, are rows', async () => {
    using _trail = await mount(AuditTrail({}))
    // 320 pixels at 28 a row fit 12, and five more below.
    expect(positions()).toEqual(Array.from({ length: 17 }, (_, at) => at + 1))
    expect(rows()[0]?.getAttribute('aria-setsize')).toBe('5000')
    scrollTo(100 * 28)
    expect(positions()[0]).toBe(96)
    expect(positions().at(-1)).toBe(117)
})

// 51.68 — A SCROLL BY ONE ROW MAKES ONE ROW AND KEEPS THE REST, and a scroll inside a row writes
// nothing. THE REVERT: drop `by entry.id`, and every row is rewritten in place where one is made;
// write `aria-posinset` from the slice's index, and every row kept takes an attribute write.
test('scrolling by a row makes the row coming into view and keeps the others', async () => {
    using _trail = await mount(AuditTrail({}))
    scrollTo(100 * 28)
    const kept = new Map(
        rows().map((row) => [row.getAttribute('aria-posinset'), row]),
    )
    const inside = measure(() => scrollTo(100 * 28 + 10))
    atMost(inside, { nodesCreated: 0, styleWrites: 0, dataWrites: 0 })
    const byOne = measure(() => scrollTo(101 * 28))
    // One row — its element, two spans and three texts, and the five attributes it is made with —
    // and the two spacers: no row kept is written to.
    atMost(byOne, { nodesCreated: 6, attributesSet: 5, styleWrites: 2 })
    for (const row of rows()) {
        const before = kept.get(
            String(Number(row.getAttribute('aria-posinset'))),
        )
        if (before !== undefined && row.textContent === before.textContent)
            expect(row).toBe(before)
    }
    const same = rows().filter((row) => [...kept.values()].includes(row))
    expect(same.length).toBe(rows().length - 1)
})
