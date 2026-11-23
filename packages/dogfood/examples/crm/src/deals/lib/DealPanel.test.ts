import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealPanel from './DealPanel.abide'

const panel = () => document.querySelector('dialog') as HTMLDialogElement
const handle = () => document.querySelector('[role=separator]') as HTMLElement

test('the deal panel opens from the edge and sizes from its handle', async () => {
    using _panel = await mount(DealPanel({}))
    expect(panel().getAttribute('data-side')).toBe('end')
    ;(document.querySelector('button') as HTMLButtonElement).click()
    flushSync()
    expect(panel().open).toBe(true)
    // The emulator lays nothing out: the panel stands 300px wide.
    panel().getBoundingClientRect = () => ({ width: 300 }) as DOMRect
    // Its handle is on its left edge: moving left grows it.
    handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    flushSync()
    expect(panel().getAttribute('style')).toBe('inline-size:310px')
    handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }))
    flushSync()
    expect(handle().getAttribute('aria-valuenow')).toBe('640')
})
