import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import getCommission from '../getCommission.handler.ts'

test('a member signed in reads their commission', async () => {
    await using app = await createApp()
    const commission = await app.run(async () => await getCommission(), {
        principal: { id: 'theo' },
    })
    expect(commission.amount).toBe('$6,200')
})

test('a caller whose session ended is refused 401', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/account/getCommission'),
    )
    // The status `onRefusal` reads in the browser, from a call nobody caught.
    expect(answer.status).toBe(401)
})
