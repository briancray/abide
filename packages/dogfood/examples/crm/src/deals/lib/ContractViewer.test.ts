import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContractViewer from './ContractViewer.abide'

const viewer = () => document.querySelector('dialog') as HTMLDialogElement
const showing = () => viewer().querySelector('.status')?.textContent
const press = (key: string) => {
    viewer().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    flushSync()
}

test('a page picked opens the viewer on it, and the arrows step it', async () => {
    using _viewer = await mount(ContractViewer({}))
    for (const button of document.querySelectorAll('.row button'))
        if (button.textContent === 'Pricing')
            (button as HTMLButtonElement).click()
    flushSync()
    expect(viewer().open).toBe(true)
    expect(showing()).toBe('Pricing')
    press('ArrowRight')
    expect(showing()).toBe('Signatures')
})

// 53.67, 50.66 — THE VIEWER LOOPS. THE REVERT: drop `loop` from the viewer, and ArrowRight on the last
// page leaves it there.
test('the arrows go from the last page to the first, and back', async () => {
    using _viewer = await mount(ContractViewer({}))
    for (const button of document.querySelectorAll('.row button'))
        if (button.textContent === 'Signatures')
            (button as HTMLButtonElement).click()
    flushSync()
    press('ArrowRight')
    expect(showing()).toBe('Terms')
    press('ArrowLeft')
    expect(showing()).toBe('Signatures')
})
