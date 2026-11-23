// 51.125-51.129 — `pages`, its parts read as a template reads them.

import { expect, test } from 'bun:test'

import { flushSync, pages, reactive } from '#shared'

const click = (part: Record<string, unknown>): void => {
    ;(part.onclick as () => void)()
    flushSync()
}

// THE REVERT: fold every run of left-out pages into a gap, and page 2 of ten on page 4 reads as a gap
// standing for a single page.
test('the pages listed are the first, the last and those around the page on, the rest gaps — 51.125', () => {
    const page = reactive(5)
    const list = pages({ count: 10, page })
    expect(list.items).toEqual([1, 'gap', 4, 5, 6, 'gap', 10])
    page.set(4)
    flushSync()
    expect(list.items).toEqual([1, 2, 3, 4, 5, 'gap', 10])
    expect(pages({ count: 3 }).items).toEqual([1, 2, 3])
    expect(pages({ count: 10, page: reactive(5), around: 2 }).items).toEqual([
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        'gap',
        10,
    ])
})

// THE REVERT: drop `aria-current` from a page's link, and the page on reads like every other.
test('a page link turns to its page, and the page on is current — 51.126, 51.127', () => {
    const list = pages({ count: 4 })
    expect(list.link(1)['aria-current']).toBe('page')
    click(list.link(3))
    expect(list.page()).toBe(3)
    expect([
        list.link(1)['aria-current'],
        list.link(3)['aria-current'],
    ]).toEqual([undefined, 'page'])
    const linked = pages({ count: 4, href: (page) => `/deals?page=${page}` })
    expect(linked.link(2).href).toBe('/deals?page=2')
})

// THE REVERT: let `previous` write `page - 1` on the first page, and it turns to page 0.
test('previous and next step one page, and stop at the ends — 51.128, 51.129', () => {
    const list = pages({ count: 3, label: 'Deal pages' })
    expect([list.previous.disabled, list.next.disabled]).toEqual([true, false])
    click(list.previous)
    expect(list.page()).toBe(1)
    click(list.next)
    click(list.next)
    expect([list.page(), list.next.disabled]).toEqual([3, true])
    click(list.next)
    expect(list.page()).toBe(3)
    const linked = pages({ count: 3, href: (page) => `?page=${page}` })
    expect([linked.previous.href, linked.previous['aria-disabled']]).toEqual([
        undefined,
        'true',
    ])
    expect(list.nav['aria-label']).toBe('Deal pages')
})
