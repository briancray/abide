import { afterAll, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContactBio from './ContactBio.abide'

// The emulator lays nothing out: a paragraph answers the heights of one holding four lines in a box
// two lines tall, and the resize observer delivers as an element is observed.
const native = globalThis.ResizeObserver
class Delivering {
    constructor(private deliver: (entries: { target: Element }[]) => void) {}
    observe(target: Element): void {
        queueMicrotask(() => this.deliver([{ target }]))
    }
    unobserve(): void {}
    disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: Delivering })
Object.defineProperties(HTMLParagraphElement.prototype, {
    scrollHeight: { configurable: true, get: () => 96 },
    clientHeight: { configurable: true, get: () => 48 },
})
afterAll(() => {
    Object.assign(globalThis, { ResizeObserver: native })
    delete (HTMLParagraphElement.prototype as { scrollHeight?: number })
        .scrollHeight
    delete (HTMLParagraphElement.prototype as { clientHeight?: number })
        .clientHeight
})

test('a bio longer than its lines is cut, and its button shows the rest', async () => {
    using _bio = await mount(ContactBio({}))
    await Bun.sleep(0)
    flushSync()
    const text = document.querySelector('p') as HTMLElement
    expect(text.getAttribute('style')).toContain('-webkit-line-clamp:2')
    const more = document.querySelector('button') as HTMLButtonElement
    expect(more.textContent).toBe('Show more')
    more.click()
    flushSync()
    expect(text.hasAttribute('style')).toBe(false)
    expect(document.querySelector('button')?.textContent).toBe('Show less')
})
