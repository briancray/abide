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

test('the link copies as one named for the deal, and as the bare address', async () => {
    using _link = await mount(DealLink({}))
    document.querySelector('button')?.click()
    await Bun.sleep(50)
    const [item] = await navigator.clipboard.read()
    const html = await (await item?.getType('text/html'))?.text()
    const plain = await (await item?.getType('text/plain'))?.text()
    expect(html).toBe(`<a href="${plain}">Analytical Engines renewal</a>`)
    expect(plain).toEndWith('/pipeline#d1')
})
