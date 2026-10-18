import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import ContactCard from './ContactCard.abide'

test('the avatar follows its name prop, and is not rebuilt', async () => {
    using _card = await mount(ContactCard({}))
    const name = document.querySelector('input') as HTMLInputElement
    const avatar = () => document.querySelector('span')?.textContent?.trim()
    expect(avatar()).toBe('GH')
    const work = measure(() => {
        name.value = 'Ada Lovelace'
        name.dispatchEvent(new Event('input'))
        flushSync()
    })
    expect(avatar()).toBe('AL')
    // The child's text rewritten in place: no node made, none moved.
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
})
