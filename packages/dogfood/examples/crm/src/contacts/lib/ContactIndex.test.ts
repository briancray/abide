import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContactIndex from './ContactIndex.abide'

const jumps = () => [...document.querySelectorAll('nav button')]
const index = () => document.querySelector('nav') as HTMLElement

/** A pointer event at `y` pixels down the index, each letter 12 pixels tall. */
function pointer(type: string, y: number): void {
    index().dispatchEvent(
        new PointerEvent(type, {
            pointerId: 1,
            button: 0,
            clientX: 4,
            clientY: y,
            bubbles: true,
        }),
    )
    flushSync()
}

// 51.96, 51.167, 51.168 — A DRAG DOWN THE A TO Z INDEX CLICKS EACH LETTER IT REACHES, ONCE, passing
// over Q, which no contact's name starts with. THE REVERT: measure the disabled letters with the rest,
// and the drag from P over Q and back clicks P a second time.
test('a drag down the index clicks each letter it reaches once, past an empty one', async () => {
    using _index = await mount(ContactIndex({}))
    const clicked: string[] = []
    jumps().forEach((jump, row) => {
        jump.getBoundingClientRect = () =>
            ({
                left: 0,
                right: 12,
                top: row * 12,
                bottom: row * 12 + 12,
            }) as DOMRect
        jump.addEventListener('click', () =>
            clicked.push(jump.textContent ?? ''),
        )
    })
    index().setPointerCapture = () => {}
    expect(jumps()[16]?.hasAttribute('disabled')).toBe(true)
    // O, then P, then Q's middle — P is the nearer letter with a contact — then back to P, then R.
    pointer('pointerdown', 14 * 12 + 6)
    pointer('pointermove', 15 * 12 + 6)
    expect(index().hasAttribute('data-scrubbing')).toBe(true)
    pointer('pointermove', 16 * 12 + 5)
    pointer('pointermove', 15 * 12 + 6)
    pointer('pointermove', 17 * 12 + 6)
    pointer('pointerup', 17 * 12 + 6)
    expect(clicked).toEqual(['P', 'R'])
    expect(index().hasAttribute('data-scrubbing')).toBe(false)
})
