import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the assistant fills the draft through draftReport', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/ops/askReport', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/jsonl',
            },
            body: JSON.stringify({
                draft: '## Problem report\n\n- traces: 4bf9\n',
            }),
        }),
    )
    const events = (await answer.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    const result = events.find((event) => event.type === 'tool_result')
    // What the page puts in the draft, read off the tool's own answer.
    expect(result.value).toEqual({
        summary: 'Statements do not send',
        description: "Grace's statement was refused. Trace 4bf9.",
    })
})
