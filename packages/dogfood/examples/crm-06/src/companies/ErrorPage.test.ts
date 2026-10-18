import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('a missing company is a 404, painted by error.abide', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/companies/initech'),
    )
    expect(answer.status).toBe(404)
    expect(await answer.text()).toContain('No such company')
})
