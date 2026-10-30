import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the page goes out without the company, and asks for it', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/companies/hopper-and-co'),
    )
    const html = await answer.text()
    // The labels went out; the values are holes the browser's call fills.
    expect(html).toContain('>pipeline</span>')
    expect(html).not.toContain('$12,500')
    expect(html).toContain('/companies/getCompany?id=hopper-and-co')
})
