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
