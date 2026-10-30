import { expect, test } from 'bun:test'

import { principal } from '@abide/abide'
import { createApp } from '@abide/abide/server'

test('the claims resolve to the member they name', async () => {
    await using app = await createApp()
    const member = await app.run(async () => await principal.resolved, {
        principal: { id: 'theo' },
    })
    expect(member.name).toBe('Theo Park')
    expect(member.role).toBe('sales')
})
