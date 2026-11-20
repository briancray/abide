import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import DealLink from './DealLink.abide'

function copied(): boolean | undefined {
    return document.querySelector('button')?.hasAttribute('data-copied')
}

test('copied shows for two seconds, then goes back', async () => {
    using _link = await mount(DealLink({}))
    document.querySelector('button')?.click()
    await Bun.sleep(50)
    expect(copied()).toBe(true)
    expect(await navigator.clipboard.readText()).toEndWith('/pipeline#d1')
    await Bun.sleep(1_800)
    expect(copied()).toBe(true)
    await Bun.sleep(300)
    expect(copied()).toBe(false)
})
