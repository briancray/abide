import { expect, spyOn, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('the body is sent as written, with the transcript', async () => {
    await using app = await createApp()
    // The stand-in answers in process, where the API answers over a network.
    const routed = (input: RequestInfo | URL, init?: RequestInit) =>
        app.fetch(new Request(input, init))
    using _routed = spyOn(globalThis, 'fetch').mockImplementation(
        routed as typeof fetch,
    )
    const answer = await app.fetch(
        new Request('http://crm.invalid/assistant/askClaude', {
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
    const sent = JSON.parse(events[0].text)
    expect(sent).toMatchObject({
        model: 'claude-opus-5',
        max_tokens: 1024,
        system: 'Answer questions about contacts.',
        stream: true,
        messages: [{ role: 'user', content: 'Which company is Ada at?' }],
    })
})
