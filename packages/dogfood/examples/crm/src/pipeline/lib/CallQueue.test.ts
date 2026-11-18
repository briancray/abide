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

test('a step moves the mark between two rows, and no other', async () => {
    using _queue = await mount(CallQueue({}))
    await settled()
    const work = measure(() => press('ArrowDown'))
    // Two rows' `data-active` and `aria-selected`, and the list's pointer.
    atMost(work, { nodesCreated: 0, attributesSet: 5 })
})
