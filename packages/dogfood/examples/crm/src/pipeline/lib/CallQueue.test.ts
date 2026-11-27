import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import CallQueue from './CallQueue.abide'

const list = () => document.querySelector('[role=listbox]') as HTMLElement
const active = () => document.querySelector('[data-active]')?.textContent

function press(key: string) {
    list().dispatchEvent(
        new KeyboardEvent('keydown', { key, cancelable: true }),
    )
    flushSync()
}

test('the arrows step through the leads, and Enter calls one', async () => {
    using _queue = await mount(CallQueue({}))
    await settled()
    const leads = [...list().children].map((lead) => lead.textContent)
    expect(leads.length).toBeGreaterThan(1)
    expect(active()).toBe(leads[0])
    press('ArrowDown')
    expect(active()).toBe(leads[1])
    expect(list().getAttribute('aria-activedescendant')).toBe(
        list().children[1]?.id ?? null,
    )
    press('End')
    press('ArrowDown')
    expect(active()).toBe(leads[0])
    press('ArrowUp')
    press('Enter')
    expect(document.querySelector('strong')?.textContent).toBe(leads.at(-1))
})

// 51.192 — A STEP WAKES THE TWO ROWS IT MOVES THE MARK BETWEEN, and binds no listener again: each
// option's handlers stand across calls, and each row reads its own `active` rather than the one key.
// THE REVERT (structural — the rows are built inside `listbox`): hand back fresh handlers per call
// and read `active() === key` in the row's getter — over three leads, 6 listeners bound and 4 wakes,
// every row woken, where 0 and 3 are due; the wakes hold at 3 however many leads are listed.
test('a step moves the mark between two rows, and no other', async () => {
    using _queue = await mount(CallQueue({}))
    await settled()
    const work = measure(() => press('ArrowDown'))
    // Two rows' `data-active` and `aria-selected`, and the list's pointer.
    atMost(work, { nodesCreated: 0, attributesSet: 5, listenersBound: 0 })
    // The two rows, and the list's `aria-activedescendant`.
    expect(work.wakes).toBe(3)
})
