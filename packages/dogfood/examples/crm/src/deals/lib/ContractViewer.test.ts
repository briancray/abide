import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContractViewer from './ContractViewer.abide'

const viewer = () => document.querySelector('dialog') as HTMLDialogElement
const showing = () => viewer().querySelector('.status')?.textContent

test('a page picked opens the viewer on it, and the arrows step it', async () => {
    using _viewer = await mount(ContractViewer({}))
    for (const button of document.querySelectorAll('.row button'))
        if (button.textContent === 'Pricing')
            (button as HTMLButtonElement).click()
    flushSync()
    expect(viewer().open).toBe(true)
    expect(showing()).toBe('Pricing')
    viewer().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    flushSync()
    expect(showing()).toBe('Signatures')
    viewer().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    flushSync()
    expect(showing()).toBe('Signatures')
})
