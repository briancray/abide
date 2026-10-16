import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('the sheet is a document of its own', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request(
            'http://crm.invalid/companies/previewCompany?id=hopper-and-co',
        ),
    )
    expect(answer.headers.get('content-type')).toContain('text/html')
    const html = await answer.text()
    expect(html).toContain('Grace Hopper')
    // No bundle: nothing in it runs in a browser.
    expect(html).not.toContain('<script')
})
