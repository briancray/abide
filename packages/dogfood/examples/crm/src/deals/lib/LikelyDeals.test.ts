import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import LikelyDeals from './LikelyDeals.abide'

const thumb = () => document.querySelector('[role=slider]') as HTMLElement
const listed = () =>
    [...document.querySelectorAll('li')].map((item) => item.textContent)
function press(key: string) {
    thumb().dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
    flushSync()
}
// Laid out 500 wide, five pixels a percent: a DOM with no layout measures every box as empty.
function pointer(type: string, clientX: number) {
    const track = document.querySelector('[data-slider=track]') as HTMLElement
    track.getBoundingClientRect = () => new DOMRect(0, 0, 500, 20)
    track.dispatchEvent(
        new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }),
    )
    flushSync()
}

// 51.184 — ONE THUMB, named by `label` and bounded by `min` and `max`, with no group around it.
// THE REVERT: name the lone thumb from `labels`, and it reads `Minimum`.
test('one thumb is a slider named by the label, bounded by min and max', async () => {
    using _deals = await mount(LikelyDeals({}))
    expect(document.querySelectorAll('[role=slider]').length).toBe(1)
    expect(document.querySelector('[role=group]')).toBeNull()
    expect(thumb().getAttribute('aria-label')).toBe('Least win probability')
    expect(thumb().getAttribute('aria-valuemin')).toBe('0')
    expect(thumb().getAttribute('aria-valuemax')).toBe('100')
    expect(thumb().getAttribute('aria-valuetext')).toBe('50%')
    expect(listed()).toEqual(['Turing seats', 'Hopper renewal'])
})

// 51.86, 51.87, 51.90 — THE KEYS STEP THE THUMB to the ends and no further, and the fill runs from
// `min` to it. THE REVERT: keep the fill's `left` at the value, and it spans nothing.
test('the keys step the thumb within min and max, the fill running from min to it', async () => {
    using _deals = await mount(LikelyDeals({}))
    press('PageUp')
    expect(thumb().getAttribute('aria-valuenow')).toBe('60')
    expect(
        document.querySelector('[data-slider=fill]')?.getAttribute('style'),
    ).toBe('left: 0%; right: 40%')
    press('End')
    press('ArrowRight')
    expect(thumb().getAttribute('aria-valuenow')).toBe('100')
    expect(listed()).toEqual([])
    press('Home')
    press('ArrowLeft')
    expect(thumb().getAttribute('aria-valuenow')).toBe('0')
    expect(listed()).toEqual([
        'Noether pilot',
        'Turing seats',
        'Hopper renewal',
    ])
})

// 51.88 — A PRESS ON THE TRACK MOVES THE THUMB there and focuses it, and a drag follows. THE REVERT:
// drop the focus after the press, and the thumb is not the active element.
test('a press moves the thumb and focuses it, and dragging moves it', async () => {
    using _deals = await mount(LikelyDeals({}))
    pointer('pointerdown', 100)
    expect(thumb().getAttribute('aria-valuenow')).toBe('20')
    expect(document.activeElement).toBe(thumb())
    pointer('pointermove', 450)
    expect(thumb().getAttribute('aria-valuenow')).toBe('90')
    pointer('pointerup', 450)
    expect(listed()).toEqual(['Hopper renewal'])
})

// 51.91 — THE VALUE IS A FIELD of the form it is in. THE REVERT: render no hidden input, and the form
// submits no probability.
test('a form holding the slider submits its value under its name', async () => {
    using _deals = await mount(LikelyDeals({}))
    press('ArrowRight')
    const fields = new FormData(
        document.querySelector('form') as HTMLFormElement,
    )
    expect(fields.getAll('probability')).toEqual(['55'])
})
