import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('the contacts page is complete before the contacts land', async () => {
    await using app = await createApp()
    const answer = await app.fetch(new Request('http://crm.invalid/contacts'))
    const page = await answer.text()
    // The whole document, closed, with a hole where the list goes.
    expect(page).toEndWith('</html>')
    expect(page).not.toContain('Ada Lovelace')
})
