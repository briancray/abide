import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import getRegistration from '../getRegistration.handler.ts'
import { registryAsked } from './registryOrigin.server.ts'

/** What the CRM answers for the company `id`, a refusal included. */
async function registrationOf(id: string) {
    await using app = await createApp()
    return app.run(async () => {
        try {
            return await getRegistration({ id })
        } catch (refusal) {
            return refusal
        }
    })
}

// THE REVERT: give up at the first 503, and Hopper & Co is refused.
test('a registry failing twice is asked a third time', async () => {
    expect(await registrationOf('hopper-and-co')).toEqual({
        founded: 1906,
        employees: 140,
    })
    expect(registryAsked('hopper-and-co')).toBe(3)
})

test('a registry that never answers is refused 502', async () => {
    expect(await registrationOf('langley-research')).toMatchObject({
        name: 'FetchFailed',
        status: 502,
        message: 'The service answered 503.',
    })
    expect(registryAsked('langley-research')).toBe(3)
})

// THE REVERT: drop `ttl`, and the registry is asked once per caller.
test('two callers at once ask the registry once', async () => {
    const answers = await Promise.all([
        registrationOf('analytical-engines'),
        registrationOf('analytical-engines'),
    ])
    expect(answers[0]).toEqual(answers[1])
    expect(registryAsked('analytical-engines')).toBe(1)
})
