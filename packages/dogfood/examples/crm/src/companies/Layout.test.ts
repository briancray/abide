import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the list and a company render inside one layout', async () => {
    await using app = await createApp()
    for (const path of ['/companies', '/companies/hopper-and-co']) {
        const answer = await app.fetch(new Request(`http://crm.invalid${path}`))
        expect(await answer.text()).toContain('placeholder="Note for the call"')
    }
})

// 35.21 — THE SERVER WRITES A COMPANY'S TOOLBAR ACTION WHERE THE PAGE WROTE IT, HIDDEN: the move into
// the layout's header is the browser's, so the header the server writes holds no button, and the
// button it does write shows nothing before then. THE REVERT: drop `hidden` from `outlet.into`'s
// part; the button is written bare, under the company's heading.
test("the server writes a company's toolbar action hidden where the page wrote it", async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/companies/hopper-and-co'),
    )
    const html = await answer.text()
    expect(
        html.slice(html.indexOf('<header'), html.indexOf('</header>')),
    ).not.toContain('Print sheet')
    expect(html).toMatch(/<button[^>]*\bhidden\b[^>]*>Print sheet<\/button>/)
})
