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

// THE REVERT: drop the `stopping.aborted` check from `followUps`, and the check finds every lead after
// the stop told it to end.
test('stopping the app ends the check in flight', async () => {
    const app = await createApp()
    const checking = found()
    expect(busy({ tags: ['follow-ups'] })).toBe(true)
    await app.stop()
    const names = await checking
    expect(busy({ tags: ['follow-ups'] })).toBe(false)
    expect(`found after the stop: ${names.length < leads().length}`).toBe(
        'found after the stop: true',
    )
})

test('the panel reads the leads the last check found', async () => {
    await using app = await createApp()
    const last = await found()
    const answer = await app.fetch(
        new Request('http://crm.invalid/ops/getFollowUps'),
    )
    const text = (await answer.text()).trim()
    const names =
        text === '' ? [] : text.split('\n').map((line) => JSON.parse(line))
    expect(names).toEqual(last)
})
