import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'
import { mount } from '@abide/harness/abide'

import AccountFeed from './AccountFeed.abide'

const kinds = () =>
    [...document.querySelectorAll('strong')].map((each) => each.textContent)

test('the button paints nothing itself: the patch it sends is what lists the call', async () => {
    using _feed = await mount(AccountFeed({}))
    await Bun.sleep(100)
    const before = kinds().length
    document.querySelector('button')?.click()
    await Bun.sleep(200)
    expect(kinds()).toHaveLength(before + 1)
    expect(kinds().at(-1)).toBe('Call')
})

// Each request is a caller of its own, as each open tab is.
test('what one caller logs, another caller reads', async () => {
    await using app = await createApp()
    await app.fetch(
        new Request('http://crm.invalid/activity/logToFeed', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ account: 'langley', kind: 'Call' }),
        }),
    )
    const answer = await app.fetch(
        new Request('http://crm.invalid/activity/feed?account=langley'),
    )
    const entries = (await answer.json()) as { kind: string }[]
    expect(entries.map((entry) => entry.kind)).toEqual(['Call'])
})
