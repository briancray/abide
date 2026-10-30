import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('a deal that does not fit is refused, field by field', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/deals/createDeal', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                name: 'Ledger audit',
                company: '',
                amount: 0,
            }),
        }),
    )
    expect(answer.status).toBe(422)
    const { data } = await answer.json()
    expect(Object.keys(data).sort()).toEqual(['amount', 'company'])
})
