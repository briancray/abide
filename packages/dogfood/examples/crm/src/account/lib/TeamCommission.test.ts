import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import { getTeamCommission } from '../getTeamCommission.server.ts'

/** What a caller signed in as `id`, or nobody, is answered. */
async function askedBy(id?: string) {
    await using app = await createApp()
    return app.run(
        async () => {
            try {
                return await getTeamCommission()
            } catch (refusal) {
                return refusal
            }
        },
        id === undefined
            ? { request: new Request('http://crm.invalid/') }
            : { principal: { id } },
    )
}

test('an admin reads the team commission', async () => {
    expect(await askedBy('maya')).toEqual({ total: '$18,400' })
})

// THE REVERT: admit anyone authenticated, and Theo reads the figure.
test('sales is refused Forbidden, at 403', async () => {
    expect(await askedBy('theo')).toMatchObject({
        name: 'Forbidden',
        status: 403,
    })
})

// THE REVERT: skip the `authenticated` check, and nobody is Forbidden.
test('nobody signed in is refused SignedOut, at 401', async () => {
    expect(await askedBy()).toMatchObject({ name: 'SignedOut', status: 401 })
})
