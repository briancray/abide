import { afterEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import WonNotice from './WonNotice.abide'

const realAnimate = Element.prototype.animate
afterEach(() => {
    Element.prototype.animate = realAnimate
})

// THE REVERT: render the notice's own text, action and close in place of `Toast`, and there is no
// "Won." and nothing that fades.
test('a notice renders through Toast, and stays until its fade has finished', async () => {
    const fading = Promise.withResolvers<void>()
    Element.prototype.animate = (() => ({
        finished: fading.promise,
    })) as unknown as typeof Element.prototype.animate
    using _notice = await mount(WonNotice({}))
    ;(
        [...document.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === 'Mark won',
        ) as HTMLButtonElement
    ).click()
    flushSync()
    const notice = document.querySelector('[data-toasts=toast]') as HTMLElement
    expect(notice.getAttribute('data-tone')).toBe('success')
    expect(notice.querySelector('strong')?.textContent).toBe('Won.')
    expect(notice.querySelector('[data-toasts=text]')).toBeNull()
    ;(
        [...notice.querySelectorAll('button')].find(
            (button) => button.textContent === 'Close',
        ) as HTMLButtonElement
    ).click()
    flushSync()
    // Out of the list, and still in the page while it fades.
    expect(notice.isConnected).toBe(true)
    fading.resolve()
    await fading.promise
    await Bun.sleep(0)
    expect(notice.isConnected).toBe(false)
})
