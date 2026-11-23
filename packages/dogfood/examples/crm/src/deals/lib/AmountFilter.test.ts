import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import AmountFilter from './AmountFilter.abide'

const thumbs = () =>
    [...document.querySelectorAll('[role=slider]')] as HTMLElement[]
const listed = () =>
    [...document.querySelectorAll('li')].map((item) => item.textContent)
function press(thumb: HTMLElement, key: string) {
    thumb.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
    flushSync()
}
// Laid out 500 wide, a hundred dollars a pixel: a DOM with no layout measures every box as empty.
function pointer(type: string, clientX: number) {
    const track = document.querySelector('[data-range=track]') as HTMLElement
    track.getBoundingClientRect = () => new DOMRect(0, 0, 500, 20)
    track.dispatchEvent(
        new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }),
    )
    flushSync()
}

// 51.85, 51.86 — EACH THUMB IS A SLIDER whose bounds are where the other stands, its value written
// as `format` writes it. THE REVERT: give the low thumb `max` as its `aria-valuemax`, and it reads
// 50000 where the high thumb's 50000 is due only by chance — move the high one first.
test('each thumb is a slider bounded by the other, its value written as money', async () => {
    using _filter = await mount(AmountFilter({}))
    const [low, high] = thumbs() as [HTMLElement, HTMLElement]
    press(high, 'PageDown')
    expect(high.getAttribute('aria-valuenow')).toBe('45000')
    expect(low.getAttribute('aria-label')).toBe('Minimum')
    expect(low.getAttribute('aria-valuemax')).toBe('45000')
    expect(high.getAttribute('aria-valuemin')).toBe('0')
    expect(high.getAttribute('aria-valuetext')).toBe('$45K')
})

// 51.87 — THE ARROWS STEP by `step`, Page Up and Page Down a tenth of the way, Home and End to the
// ends — and 51.86, the low thumb stops at the high one. THE REVERT: drop the clamp to the other
// thumb, and End takes the low thumb past the high.
test('the keys step a thumb, and the low one stops at the high', async () => {
    using _filter = await mount(AmountFilter({}))
    const [low, high] = thumbs() as [HTMLElement, HTMLElement]
    press(low, 'ArrowRight')
    expect(low.getAttribute('aria-valuenow')).toBe('500')
    press(low, 'PageUp')
    expect(low.getAttribute('aria-valuenow')).toBe('5500')
    press(high, 'Home')
    expect(high.getAttribute('aria-valuenow')).toBe('5500')
    press(low, 'End')
    expect(low.getAttribute('aria-valuenow')).toBe('5500')
    expect(listed()).toEqual([])
    press(high, 'ArrowUp')
    press(high, 'End')
    expect(listed()).toEqual([
        'Noether pilot',
        'Lovelace audit',
        'Turing seats',
        'Hopper renewal',
    ])
})

// 51.88, 51.90 — THE POINTER TAKES THE THUMB NEARER IT and drags it while held, the range carrying
// `data-dragging` meanwhile. THE REVERT: always take the
// low thumb, and a press near the high end drags the low one there.
test('a press takes the nearer thumb, and dragging moves it', async () => {
    using _filter = await mount(AmountFilter({}))
    pointer('pointerdown', 400)
    expect(thumbs()[1]?.getAttribute('aria-valuenow')).toBe('40000')
    expect(document.activeElement).toBe(thumbs()[1] as HTMLElement)
    expect(thumbs()[0]?.getAttribute('aria-valuenow')).toBe('0')
    const root = document.querySelector('[role=group]') as HTMLElement
    expect(root.hasAttribute('data-dragging')).toBe(true)
    pointer('pointermove', 100)
    expect(thumbs()[1]?.getAttribute('aria-valuenow')).toBe('10000')
    pointer('pointerup', 100)
    expect(root.hasAttribute('data-dragging')).toBe(false)
    pointer('pointermove', 300)
    expect(thumbs()[1]?.getAttribute('aria-valuenow')).toBe('10000')
    expect(listed()).toEqual(['Noether pilot', 'Lovelace audit'])
})

// 51.91 — EACH END IS A FIELD of the form it is in, low then high. THE REVERT: render no hidden
// inputs, and the form submits no amount.
test('a form holding the range submits both ends under its name', async () => {
    using _filter = await mount(AmountFilter({}))
    press(thumbs()[0] as HTMLElement, 'PageUp')
    const fields = new FormData(
        document.querySelector('form') as HTMLFormElement,
    )
    expect(fields.getAll('amount')).toEqual(['5000', '50000'])
})
