import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('one file answers for every company, reading its id', async () => {
    await using app = await createApp()
    for (const id of ['hopper-and-co', 'langley-research']) {
        const answer = await app.fetch(
            new Request(`http://crm.invalid/companies/${id}`),
        )
        expect(answer.status).toBe(200)
        // The page asked for the company its address names.
        expect(await answer.text()).toContain(`getCompany?id=${id}`)
    }
})
