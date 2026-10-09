import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createApp } from 'abide/server'
import { startHookDatabase } from '#server/startHookDatabase'

// `createApp` finds the app in the working directory (38.26).
const startedIn = process.cwd()
beforeAll(() => process.chdir(`${import.meta.dir}/..`))
afterAll(() => process.chdir(startedIn))

test('the pool handler answers in process as it does on the wire', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://app.invalid/__abide/rpc/startHookPool/poolState'),
    )
    expect(answer.status).toBe(200)
    expect(answer.headers.get('traceresponse')).not.toBeNull()
})

test('stopping the app closes the pool onStart opened', async () => {
    const app = await createApp()
    expect(startHookDatabase.connected).toBe(true)
    await app.stop()
    expect(startHookDatabase.connected).toBe(false)
})
