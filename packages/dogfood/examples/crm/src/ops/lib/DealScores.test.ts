import { expect, test } from 'bun:test'

import { busy } from '@abide/abide'
import { createApp } from '@abide/abide/server'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'
import { dealScores } from './dealScores.server.ts'

const scored = async (): Promise<string[]> => {
    const names: string[] = []
    for await (const deal of dealScores()) names.push(deal.name)
    return names
}

test('the app answers a request while the deals are being scored', async () => {
    await using app = await createApp()
    const scoring = scored()
    const answer = await app.fetch(
        new Request('http://crm.invalid/ops/getPool'),
    )
    expect(answer.status).toBe(200)
    expect(busy({ tags: ['scores'] })).toBe(true)
    expect(await scoring).toEqual(DEALS.map((deal) => deal.name))
})

test('a stop ends the scoring', async () => {
    const app = await createApp()
    dealScores.refresh()
    expect(busy({ tags: ['scores'] })).toBe(true)
    await app.stop()
    expect(busy({ tags: ['scores'] })).toBe(false)
})
