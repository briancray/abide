import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import { crmDatabase } from '../../pipeline/lib/crmDatabase.server.ts'
import { getDigest } from '../getDigest.server.ts'
import { sendDigest } from '../sendDigest.server.ts'

const sent = () =>
    crmDatabase()
        .query<{ count: number }, []>('SELECT count(*) AS count FROM digests')
        .get()?.count

// THE REVERT: send once per ask rather than join, and the team is mailed twice.
test('a send asked for while one is going out joins it', async () => {
    await using app = await createApp()
    const before = sent()
    const [first, second] = await Promise.all([
        app.run(() => sendDigest()),
        app.run(() => sendDigest()),
    ])
    expect(second.lastRun).toBe(first.lastRun)
    expect(sent()).toBe((before ?? 0) + 1)
})

test('the panel reads when the digest went out, and goes next', async () => {
    await using app = await createApp()
    await app.run(() => sendDigest())
    const status = await app.run(async () => await getDigest())
    expect(status.running).toBe(false)
    // The next weekday morning at eight on New York's clock, after the send that just went out.
    const next = new Date(status.nextRun ?? '')
    expect(next.getTime()).toBeGreaterThan(Date.parse(status.lastRun ?? ''))
    const newYork = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
    }).formatToParts(next)
    const part = (type: string) =>
        newYork.find((piece) => piece.type === type)?.value
    expect(`${part('hour')}:${part('minute')}`).toBe('08:00')
    expect(['Sat', 'Sun']).not.toContain(part('weekday'))
})
