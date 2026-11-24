import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import WebhookPayload from './WebhookPayload.abide'

const items = () =>
    [...document.querySelectorAll('[role=treeitem]')] as HTMLElement[]
// A row's item by its pointer, as the parts write its id.
const at = (pointer: string) =>
    document.getElementById(
        `webhook-${encodeURIComponent(pointer)}`,
    ) as HTMLElement
const shown = () =>
    items().map((item) => decodeURIComponent(item.id.slice('webhook-'.length)))
const status = () => document.querySelector('.status')?.textContent?.trim()
function search(text: string) {
    const input = document.querySelector(
        '[data-json-inspector=search]',
    ) as HTMLInputElement
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}
function press(key: string) {
    ;(document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
    )
    flushSync()
}

// 51.153, 51.154, 51.155, 51.161 — A ROW PER VALUE, told apart by its pointer, the root open and the
// rest shut; Right opens a row in place. THE REVERT: start `expanded` empty, and only the root shows.
test('a row per value, told apart by its pointer, with the root open', async () => {
    using _payload = await mount(WebhookPayload({}))
    expect(shown()).toEqual([
        '',
        '/id',
        '/type',
        '/live',
        '/invoice',
        '/metadata',
    ])
    expect(at('/invoice').getAttribute('aria-level')).toBe('2')
    expect(at('/invoice').getAttribute('aria-expanded')).toBe('false')
    at('/invoice').focus()
    press('ArrowRight')
    expect(shown()).toContain('/invoice/lines')
    expect(shown().indexOf('/invoice/number')).toBe(
        shown().indexOf('/invoice') + 1,
    )
})

// 51.156, 51.157, 51.158 — A SEARCH SHOWS WHAT MATCHES AND WHAT HOLDS IT, opened, each match marked,
// and clearing it gives back the tree as it was. THE REVERT: mark every row that shows, and
// `/invoice` carries `data-match`.
test('a search shows its matches and what holds them, opened and marked', async () => {
    using _payload = await mount(WebhookPayload({}))
    search('grace')
    expect(shown()).toEqual([
        '',
        '/invoice',
        '/invoice/paidBy',
        '/invoice/paidBy/name',
        '/invoice/paidBy/email',
    ])
    expect(status()).toBe('2 found')
    expect(at('/invoice/paidBy/name').hasAttribute('data-match')).toBe(true)
    expect(at('/invoice').hasAttribute('data-match')).toBe(false)
    expect(at('/invoice/paidBy/name').querySelector('mark')?.textContent).toBe(
        'Grace',
    )
    search('')
    expect(shown()).toEqual([
        '',
        '/id',
        '/type',
        '/live',
        '/invoice',
        '/metadata',
    ])
})

// 51.157 — A ROW SHUT DURING A SEARCH STAYS SHUT UNTIL THE SEARCH CHANGES, and what it shut is not
// written to `expanded`. THE REVERTS: read the rows holding a match as open whatever was toggled, and
// Left on `/invoice/paidBy` leaves its rows showing; write the toggle to `expanded`, and `/invoice`
// stays open once the search is cleared.
test('a row shut during a search stays shut until the search changes', async () => {
    using _payload = await mount(WebhookPayload({}))
    search('grace')
    at('/invoice/paidBy').focus()
    press('ArrowLeft')
    expect(shown()).toEqual(['', '/invoice', '/invoice/paidBy'])
    search('grace@')
    expect(shown()).toEqual([
        '',
        '/invoice',
        '/invoice/paidBy',
        '/invoice/paidBy/email',
    ])
    search('')
    expect(shown()).toEqual([
        '',
        '/id',
        '/type',
        '/live',
        '/invoice',
        '/metadata',
    ])
})

// 51.156 — A KEY OR A VALUE THAT MATCHES KEEPS ALL IT HOLDS, shut until opened. THE REVERT: keep only
// the entries that match under a match, and `/invoice/lines` shows as a leaf.
test('a matching row keeps everything it holds', async () => {
    using _payload = await mount(WebhookPayload({}))
    search('lines')
    expect(shown()).toEqual(['', '/invoice', '/invoice/lines'])
    expect(at('/invoice/lines').getAttribute('aria-expanded')).toBe('false')
    at('/invoice/lines').focus()
    press('ArrowRight')
    expect(shown()).toContain('/invoice/lines/1')
})

// 51.153, 51.160 — A CLICK PICKS A ROW, and what it picked is inspected by its pointer, a `/` in a key
// written `~1`. THE REVERT: join keys with no escape, and the pointer reads `/metadata/crm/account`.
test('a click picks a row, and the row picked is inspected', async () => {
    using _payload = await mount(WebhookPayload({}))
    expect(status()).toBe('no value picked')
    at('/metadata').focus()
    press('ArrowRight')
    at('/metadata/crm~1account').click()
    flushSync()
    expect(status()).toBe('/metadata/crm~1account')
    expect(document.querySelector('pre')?.textContent).toBe('"hopper"')
})
