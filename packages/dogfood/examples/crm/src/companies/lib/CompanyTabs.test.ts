import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the open tab is read from the address', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/companies/hopper-and-co?tab=notes'),
    )
    expect(await answer.text()).toContain('aria-selected="true">notes')
})
