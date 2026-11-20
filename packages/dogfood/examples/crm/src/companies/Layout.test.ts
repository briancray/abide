import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the list and a company render inside one layout', async () => {
    await using app = await createApp()
    for (const path of ['/companies', '/companies/hopper-and-co']) {
        const answer = await app.fetch(new Request(`http://crm.invalid${path}`))
        expect(await answer.text()).toContain('placeholder="Note for the call"')
    }
})

// 35.20, 35.21 — A PAGE FILLS ITS LAYOUT'S TOOLBAR, AND THE SERVER PAINTS IT THERE: the company page's
// `fill` is made in its setup, which runs before the layout's `Outlet` is built, so the button is in
// the header the server writes — and the list, which fills nothing, has none.
// THE REVERT: have the `Outlet` render nothing on the server, and the company's header has no button.
test("a company's page fills the layout's toolbar, painted by the server", async () => {
    await using app = await createApp()
    const header = async (path: string) => {
        const answer = await app.fetch(new Request(`http://crm.invalid${path}`))
        const html = await answer.text()
        return html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    }
    expect(await header('/companies/hopper-and-co')).toContain('Print sheet')
    expect(await header('/companies')).not.toContain('Print sheet')
})
