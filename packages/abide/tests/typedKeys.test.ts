// 49.21 — A KEY IS KEPT AS IT IS: what a headless component picks is typed by what its items' keys are
// — the item itself, its `id`, or what `key` answers — and compared exactly, a number never becoming
// its text except in an element's id. The assignments below are the type test: `bun run typecheck`
// fails on each where `value` is `Picked<string, …>` again.
//
// THE REVERT: put `toggleGroup.ts`, `tabs.ts` and `listbox.ts` back to their string keys and the
// check reports TS2322 at every `Reactive<number | undefined>` below, and the runtime half reads
// `'2'` where `2` is due.

import { expect, test } from 'bun:test'

import {
    accordion,
    flushSync,
    listbox,
    type Reactive,
    reactive,
    sortableTable,
    tabs,
    toggleGroup,
    tree,
    wizard,
} from '#shared'

const click = (part: Record<string, unknown>): void => {
    ;(part.onclick as (event: MouseEvent) => void)(new MouseEvent('click'))
    flushSync()
}

test('a number key is picked as a number, and written as text only in an id — 49.21', () => {
    const watch = reactive<number | undefined>(undefined)
    const picker = toggleGroup({
        id: 'watch',
        items: [{ id: 1 }, { id: 2 }],
        value: watch,
    })
    const typed: Reactive<number | undefined> = picker.value
    click(picker.item({ id: 2 }))
    expect(typed.get()).toBe(2)
    expect(picker.item({ id: 2 }).id).toBe('watch-2')
    expect(picker.item({ id: 2 })['aria-checked']).toBe('true')

    const views = tabs({ items: [10, 20] })
    const shown: Reactive<number | undefined> = views.selected
    click(views.tab(20).button)
    expect(shown.get()).toBe(20)

    const people = listbox({
        options: [{ name: 'Ada', born: 1815 }],
        key: (person) => person.born,
        multiple: true,
    })
    const born: Reactive<readonly number[]> = people.selected
    void born
})

test('every component picking by key is typed by its keys — 49.21', () => {
    type Job = 'Actor' | 'Director'
    const jobs: Job[] = ['Actor', 'Director']
    const job = reactive<Job | undefined>(undefined)
    toggleGroup({ items: jobs, value: job })
    const text = reactive<string | undefined>(undefined)
    // @ts-expect-error — a key the items do not answer: numbers' value is no text.
    toggleGroup({ items: [1, 2], value: text })
    // Text items picked as a union of their words need no `key`, and a `key` answering a number is
    // picked by a number `value` — the two inferences the checker has to make together.
    const sort = reactive<'amount' | 'idle'>('amount')
    toggleGroup({ items: ['amount', 'idle'], value: sort })
    const order = reactive<number | undefined>(undefined)
    toggleGroup({
        items: [{ id: 'a', order: 3 }],
        key: (season) => season.order,
        value: order,
    })
    // @ts-expect-error — a record with no `id` names its key.
    toggleGroup({ items: [{ name: 'x' }] })
    const open: Reactive<number | undefined> = accordion({
        open: reactive<number | undefined>(1),
    }).open
    const rows: Reactive<readonly number[] | undefined> = sortableTable({
        rows: [{ id: 3 }],
        columns: [],
    }).selected
    const nodes: Reactive<readonly number[]> = tree({
        roots: [{ id: 4 }],
        children: () => [],
        label: () => 'four',
    }).expanded
    const step: Reactive<number | undefined> = wizard({
        steps: [1, 2, 3],
    }).current
    void [open, rows, nodes, step]
    expect(true).toBe(true)
})
