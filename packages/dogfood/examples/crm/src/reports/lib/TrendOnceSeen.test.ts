import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import TrendOnceSeen from './TrendOnceSeen.abide'

// The DOM a test mounts in computes no intersections, so the viewport's observer is one this test
// delivers through, installed before the mount makes it.
const viewport = {
    observed: new Set<Element>(),
    deliver: undefined as
        | ((entries: { target: Element; isIntersecting: boolean }[]) => void)
        | undefined,
}
globalThis.IntersectionObserver = class {
    constructor(deliver: typeof viewport.deliver) {
        viewport.deliver = deliver
    }
    observe(element: Element) {
        viewport.observed.add(element)
    }
    unobserve(element: Element) {
        viewport.observed.delete(element)
    }
    disconnect() {
        viewport.observed.clear()
    }
} as unknown as typeof IntersectionObserver

const seen = (isIntersecting: boolean) => {
    const target = document.querySelector('section') as Element
    viewport.deliver?.([{ target, isIntersecting }])
    flushSync()
}

// 32.100 — THE CHART IS DRAWN THE FIRST TIME THE REPORT SCROLLS TO IT, AND KEPT: the section is
// unobserved once seen, so scrolling it away again leaves the chart standing. THE REVERT: drop
// `once: true`; the section is still observed after it is seen, 1 element where 0 are.
test('the trend is drawn when first scrolled to, and stays when scrolled away', async () => {
    using _trend = await mount(TrendOnceSeen({}))
    seen(false)
    expect(document.querySelector('svg')).toBeNull()
    seen(true)
    expect(document.querySelector('svg')).not.toBeNull()
    expect(viewport.observed.size).toBe(0)
    seen(false)
    expect(document.querySelector('svg')).not.toBeNull()
})
