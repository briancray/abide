import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the export is a file, written a row at a time', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/activity/exportCsv'),
    )
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('date,kind,note\n')
    await reader.cancel()
})
