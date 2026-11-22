import { expect, test } from 'bun:test'

import { mount, settled } from '@abide/harness/abide'

import OpenDeals from './OpenDeals.abide'

// The DOM a test mounts in lays nothing out, so the list is given the geometry a browser would:
// 96px tall over 24px a deal, scrolled to `top`.
function laidOut(list: HTMLElement) {
    const scrolled = { top: 0 }
    const define = (name: string, get: () => number) =>
        Object.defineProperty(list, name, { get, configurable: true })
    define('clientHeight', () => 96)
    define('scrollHeight', () => list.children.length * 24)
    define('scrollTop', () => scrolled.top)
    return scrolled
}

const frame = () =>
    new Promise((done) => requestAnimationFrame(() => done(undefined)))

// 32.101, 32.103 — THE DEALS THAT LAND PAST THE LIST'S HEIGHT MARK ITS BOTTOM, and scrolling to the
// end moves the mark to its top. THE REVERT: drop `bind:element={scrollEdges}`; the list carries no
// `data-scrollable` and nothing fades.
test("deals past the list's height mark its bottom, and scrolling to the end its top", async () => {
    using _deals = await mount(OpenDeals({}))
    const list = document.querySelector('ol') as HTMLElement
    const scrolled = laidOut(list)
    await settled()
    await frame()
    expect(list.children.length).toBeGreaterThan(4)
    expect(list.dataset.scrollable).toBe('bottom')
    scrolled.top = list.children.length * 24 - 96
    list.dispatchEvent(new Event('scroll'))
    await frame()
    expect(list.dataset.scrollable).toBe('top')
})
