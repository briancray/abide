import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('the caller gets a bare 500, and onError gets the reason', async () => {
    await using app = await createApp()
    const failed = await app.fetch(
        new Request('http://crm.invalid/companies/exportCompanies', {
            method: 'POST',
        }),
    )
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain('export worker')
    const reported = await app.fetch(
        new Request('http://crm.invalid/companies/reportedErrors'),
    )
    expect(await reported.json()).toEqual([
        'the export worker reset the connection',
    ])
})
