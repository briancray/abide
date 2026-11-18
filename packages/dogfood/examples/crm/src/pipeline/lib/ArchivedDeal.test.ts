import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

const ask = (method: string) =>
    new Request(
        `http://crm.invalid/pipeline/archive/${
            method === 'GET' ? 'getArchivedDeal' : 'reopenDeal'
        }`,
        { method, headers: { 'content-type': 'application/json' } },
    )

test('the archive answers a read', async () => {
    await using app = await createApp()
    const answer = await app.fetch(ask('GET'))
    expect(await answer.json()).toMatchObject({ stage: 'won' })
})

// THE REVERT: let every method through, and the deal is reopened.
test('the archive refuses a change ReadOnly, at 403', async () => {
    await using app = await createApp()
    const answer = await app.fetch(ask('POST'))
    expect(answer.status).toBe(403)
    expect(await answer.json()).toMatchObject({
        type: 'ReadOnly',
        detail: 'Last year’s pipeline is archived.',
    })
    const deal = await app.fetch(ask('GET'))
    expect(await deal.json()).toMatchObject({ stage: 'won' })
})
