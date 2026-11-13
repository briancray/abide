import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

// The file's path, then the handler's name.
const NOTES = '/__abide/handlers/deals/lib/DealNotes/getNotes'

test('the private handler answers below /__abide/handlers', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request(`http://crm.invalid${NOTES}?id=d1`),
    )
    expect(await answer.json()).toEqual(['Wants a three-year term.'])
})
