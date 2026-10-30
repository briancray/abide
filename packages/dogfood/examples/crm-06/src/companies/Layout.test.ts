import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the list and a company render inside one layout', async () => {
    await using app = await createApp()
    for (const path of ['/companies', '/companies/hopper-and-co']) {
        const answer = await app.fetch(new Request(`http://crm.invalid${path}`))
        expect(await answer.text()).toContain('placeholder="Note for the call"')
    }
})
