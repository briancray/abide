// 51.116-51.124 — `disclosure`, the `accordion` made of one per key, and `clamp`, a disclosure's button
// over text cut to a few lines. The emulator lays nothing out, so a clamped text's heights are
// answered here and its resize delivered when a test says so.

import { afterEach, expect, test } from 'bun:test'

import { accordion, clamp, disclosure, flushSync, reactive } from '#shared'

import { bindPart } from './bindPart.ts'

// The shared resize observer is made by the first bind (32.81), so the stand-in is installed at load.
type Delivery = (entries: { target: Element }[]) => void
let deliver: Delivery | undefined
class ResizeStandIn {
    constructor(given: Delivery) {
        deliver = given
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: ResizeStandIn })

const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

const click = (part: Record<string, unknown>): void => {
    ;(part.onclick as () => void)()
    flushSync()
}

// THE REVERT: drop the `onclick` from the button, and a press leaves the region hidden.
test('a disclosure opens its region on a click, and names it — 51.116, 51.117, 51.119', () => {
    const more = disclosure({ id: 'terms' })
    expect([
        more.button['aria-controls'],
        more.button['aria-expanded'],
        more.region.id,
        more.region.hidden,
    ]).toEqual(['terms-region', 'false', 'terms-region', 'until-found'])
    click(more.button)
    expect([
        more.open(),
        more.button['aria-expanded'],
        more.region.hidden,
        more.region['data-open'],
    ]).toEqual([true, 'true', undefined, ''])
})

// THE REVERT: hide the region with a bare `hidden`, and find in page has nothing to reveal — nor a
// `beforematch` to open it.
test('find in page reaching a shut region opens it — 51.118', () => {
    const more = disclosure()
    ;(more.region.onbeforematch as () => void)()
    flushSync()
    expect(more.open()).toBe(true)
})

// THE REVERT: close a key only where many may be open, and closing the one key open writes an
// array where `undefined` is due; hand back the disclosure's parts bare, and no part carries
// `data-accordion`.
test('an accordion opens one key at a time, and closing it leaves none — 51.120, 51.121', () => {
    const faq = accordion()
    click(faq.item('pricing').button)
    expect(faq.open()).toBe('pricing')
    click(faq.item('billing').button)
    expect(faq.open()).toBe('billing')
    expect(faq.item('pricing').region.hidden).toBe('until-found')
    click(faq.item('billing').button)
    expect(faq.open()).toBeUndefined()
    // A key's parts are built once: a render asking again gets the same ones.
    expect(faq.item('pricing')).toBe(faq.item('pricing'))
    // 49.3 — a key's parts are named for the accordion, beside the disclosure's they are.
    const pricing = faq.item('pricing')
    expect([
        pricing.button['data-accordion'],
        pricing.region['data-accordion'],
        pricing.button['data-disclosure'],
    ]).toEqual(['button', 'region', 'button'])
    const many = accordion({
        multiple: true,
        open: reactive<readonly string[]>([]),
    })
    click(many.item('a').button)
    click(many.item('b').button)
    expect(many.open()).toEqual(['a', 'b'])
    click(many.item('a').button)
    expect(many.open()).toEqual(['b'])
})

// THE REVERT: drop the measure from the text's binding, and `overflowing` stays false over text that
// runs past its lines.
test('a clamp cuts its text to its lines, says when there is more, and its button shows it — 51.122, 51.123, 51.124', () => {
    const summary = clamp({ lines: 2, id: 'summary' })
    expect(summary.text.style).toContain('-webkit-line-clamp:2')
    expect(summary.button['aria-controls']).toBe(summary.text.id)
    const text = document.createElement('p')
    Object.defineProperty(text, 'scrollHeight', { value: 96 })
    Object.defineProperty(text, 'clientHeight', { value: 48 })
    document.body.append(text)
    bound.push(bindPart(summary.text, text))
    deliver?.([{ target: text }])
    flushSync()
    expect(summary.overflowing).toBe(true)
    click(summary.button)
    expect([summary.open(), summary.text.style]).toEqual([true, undefined])
    // Open, it keeps the answer it had, so the button cutting it back stays.
    deliver?.([{ target: text }])
    expect(summary.overflowing).toBe(true)
})
