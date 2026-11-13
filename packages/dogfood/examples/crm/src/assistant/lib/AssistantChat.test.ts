import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the model calls the CRM search, through the app', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/assistant/askAssistant', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/jsonl',
            },
            body: JSON.stringify({
                messages: [
                    { role: 'user', content: 'Which company is Ada at?' },
                ],
            }),
        }),
    )
    const events = (await answer.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    const result = events.find((event) => event.type === 'result')
    expect(JSON.parse(result.text)).toEqual([
        { id: 'c1', name: 'Ada Lovelace', company: 'Analytical Engines' },
    ])
})
