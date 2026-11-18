import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import { crmDatabase } from '../../pipeline/lib/crmDatabase.server.ts'
import getDigest from '../getDigest.handler.ts'
import sendDigest from '../sendDigest.handler.ts'

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
    const day =
        Date.parse(status.nextRun ?? '') - Date.parse(status.lastRun ?? '')
    expect(day).toBe(24 * 60 * 60_000)
})
