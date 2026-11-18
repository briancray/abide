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

test('a stop ends the scoring and keeps the scores held', async () => {
    const app = await createApp()
    const held = dealScores.peek()
    dealScores.refresh()
    expect(dealScores.busy()).toBe(true)
    await app.stop()
    expect(dealScores.busy()).toBe(false)
    expect(dealScores.peek()).toEqual(held)
})
