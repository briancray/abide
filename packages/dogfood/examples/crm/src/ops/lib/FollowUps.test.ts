import { expect, test } from 'bun:test'

import { busy } from '@abide/abide'
import { createApp } from '@abide/abide/server'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'
import { followUps } from './followUps.ts'

// Whatever is still a lead: another test may have won one.
const leads = (): string[] =>
    DEALS.filter((deal) => deal.stage === 'lead').map((deal) => deal.name)

const found = async (): Promise<string[]> => {
    const names: string[] = []
    for await (const name of followUps()) names.push(name)
    return names
}

test('stopping the app waits for the check in flight', async () => {
    const app = await createApp()
    const checking = found()
    expect(busy({ tags: ['follow-ups'] })).toBe(true)
    await app.stop()
    expect(busy({ tags: ['follow-ups'] })).toBe(false)
    expect(await checking).toEqual(leads())
})

test('the panel reads the leads the last check found', async () => {
    await using app = await createApp()
    await found()
    const answer = await app.fetch(
        new Request('http://crm.invalid/ops/getFollowUps'),
    )
    const lines = (await answer.text()).trim().split('\n')
    expect(lines.map((line) => JSON.parse(line))).toEqual(leads())
})
