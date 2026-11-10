import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test("the list row and the company's heading share one name", async () => {
    await using app = await createApp()
    for (const path of ['/companies', '/companies/hopper-and-co']) {
        const answer = await app.fetch(new Request(`http://crm.invalid${path}`))
        expect(await answer.text()).toContain(
            'view-transition-name: company-hopper-and-co',
        )
    }
})

test('the transition rule reaches the document, not one component', async () => {
    await using app = await createApp()
    const page = await app.fetch(new Request('http://crm.invalid/companies'))
    const sheet = /href="([^"]+\.css)"/.exec(await page.text())?.[1]
    const css = await app.fetch(new Request(`http://crm.invalid${sheet}`))
    // A scope token in front, `[a-…]::view-transition-group`, matches nothing.
    expect(await css.text()).toMatch(/[^\]]::view-transition-group\(\*\)/)
})
