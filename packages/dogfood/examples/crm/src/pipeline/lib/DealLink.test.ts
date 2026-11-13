import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import DealLink from './DealLink.abide'

function label(): string | null | undefined {
    return document.querySelector('button')?.textContent
}

test('copied shows for two seconds, then goes back', async () => {
    using _link = await mount(DealLink({}))
    document.querySelector('button')?.click()
    await Bun.sleep(50)
    expect(label()).toBe('Copied')
    expect(await navigator.clipboard.readText()).toEndWith('/pipeline#d1')
    await Bun.sleep(1_800)
    expect(label()).toBe('Copied')
    await Bun.sleep(300)
    expect(label()).toBe('Copy link')
})
