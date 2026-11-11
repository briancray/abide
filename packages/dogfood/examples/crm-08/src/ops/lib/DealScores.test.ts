import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'
import { dealScores } from './dealScores.ts'

test('the app answers a request while the deals are being scored', async () => {
    await using app = await createApp()
    dealScores.refresh()
    const answer = await app.fetch(
        new Request('http://crm.invalid/ops/getPool'),
    )
    expect(answer.status).toBe(200)
    expect(dealScores.busy()).toBe(true)
    const scores = await dealScores
    expect(scores.map((deal) => deal.name)).toEqual(
        DEALS.map((deal) => deal.name),
    )
})
