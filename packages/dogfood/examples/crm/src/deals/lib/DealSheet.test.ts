import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealSheet from './DealSheet.abide'

const sheet = () => document.querySelector('dialog') as HTMLDialogElement
const grip = () => document.querySelector('[role=separator]') as HTMLElement

// A pointer event at one instant, so a drag's speed carries it nowhere.
function pointer(type: string, clientY: number): void {
    const event = new PointerEvent(type, { clientY, button: 0, buttons: 1 })
    Object.defineProperty(event, 'timeStamp', { value: 0 })
    grip().dispatchEvent(event)
    flushSync()
}

test('the deal sheet follows a drag by a transform, and a tap steps it', async () => {
    Object.defineProperty(globalThis, 'innerHeight', { configurable: true, value: 800 })
    using _sheet = await mount(DealSheet({}))
    ;(document.querySelector('button') as HTMLButtonElement).click()
    flushSync()
    expect(sheet().open).toBe(true)
    // The emulator lays nothing out: the sheet stands at half the screen.
    sheet().getBoundingClientRect = () => ({ height: 400 }) as DOMRect
    // A tap on the grip steps it to nearly all of the screen, and another back to half.
    pointer('pointerdown', 500)
    pointer('pointerup', 500)
    expect(sheet().getAttribute('style')).toBe('block-size:720px')
    pointer('pointerdown', 500)
    pointer('pointerup', 500)
    expect(sheet().getAttribute('style')).toBe('block-size:400px')
    // Dragged up, it stands at its tallest once and follows by a transform alone.
    pointer('pointerdown', 400)
    pointer('pointermove', 350)
    expect(sheet().getAttribute('style')).toBe('block-size:720px;transform:translateY(270px)')
    expect(sheet().hasAttribute('data-following')).toBe(true)
    pointer('pointermove', 150)
    expect(sheet().getAttribute('style')).toBe('block-size:720px;transform:translateY(70px)')
    // Let go at 650, nearest nearly all of it; the emulator runs no transition, so it is sized at once.
    pointer('pointerup', 150)
    expect(sheet().getAttribute('style')).toBe('block-size:720px')
    expect(sheet().hasAttribute('data-following')).toBe(false)
})
