import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealSplit from './DealSplit.abide'

const handle = () => document.querySelector('[role=separator]') as HTMLElement
const list = () => document.querySelector('ul') as HTMLElement
const key = (name: string) => {
    handle().dispatchEvent(
        new KeyboardEvent('keydown', { key: name, cancelable: true }),
    )
    flushSync()
}

test('the deal list sizes from its handle, within its bounds', async () => {
    using _split = await mount(DealSplit({}))
    // The emulator lays nothing out: the list stands 200px wide in a row 640px wide.
    Object.defineProperty(list().parentElement, 'clientWidth', { value: 640 })
    list().getBoundingClientRect = () => ({ width: 200 }) as DOMRect
    expect(handle().getAttribute('aria-controls')).toBe(list().id)
    key('ArrowRight')
    expect(list().getAttribute('style')).toBe('inline-size:210px')
    key('End')
    expect(list().getAttribute('style')).toBe('inline-size:360px')
    key('Home')
    expect(handle().getAttribute('aria-valuenow')).toBe('140')
    handle().dispatchEvent(new MouseEvent('dblclick'))
    flushSync()
    expect(list().hasAttribute('style')).toBe(false)
})
