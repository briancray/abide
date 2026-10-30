import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'
import { COMPANIES } from './lib/COMPANIES.server.ts'

test('the company page takes every id the CRM has, and no name', async () => {
    await using app = await createApp()
    for (const { id } of COMPANIES) {
        const answer = await app.fetch(
            new Request(`http://crm.invalid/companies/${id}`),
        )
        expect(answer.status).toBe(200)
        await answer.body?.cancel()
    }
    const pasted = await app.fetch(
        new Request('http://crm.invalid/companies/Hopper%20%26%20Co'),
    )
    expect(pasted.status).toBe(404)
})
