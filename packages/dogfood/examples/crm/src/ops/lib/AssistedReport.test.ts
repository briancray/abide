import { expect, test } from 'bun:test'

import { chat } from '@abide/abide'
import { createApp } from '@abide/abide/server'

import draftReport from '../draftReport.handler.ts'

// The events the assistant answers a draft with, through the app.
async function answered(draft: string) {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/ops/askReport', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/jsonl',
            },
            body: JSON.stringify({ draft }),
        }),
    )
    return (await answer.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
}

test('the assistant fills the draft through draftReport', async () => {
    const events = await answered('## Problem report\n\n- traces: 4bf9\n')
    const result = events.find((event) => event.type === 'tool_result')
    // What the page puts in the draft, read off the tool's own answer.
    expect(result.value).toEqual({
        summary: 'Statements do not send',
        description: "Grace's statement was refused. Trace 4bf9.",
    })
})

// 53.109 — WHAT THE PAGE PUTS IN THE DRAFT, read off its conversation as `AssistedReport` reads it:
// `talk.calls(draftReport)`, the call found by the tool the handler is listed under. THE REVERT:
// have `chat` hand `callsOf` the handler's address in place of its tool, and it finds no call.
test('the page reads what the assistant wrote off its calls to draftReport', async () => {
    const events = await answered('## Problem report\n\n- traces: 4bf9\n')
    const talk = chat({
        async *ask() {
            yield* events
        },
    })
    talk.draft.set({ role: 'user', content: 'Write my problem report.' })
    talk.submit()
    while (talk.messages().length < 2 || talk.streaming) await Bun.sleep(1)
    const [written] = talk.calls(draftReport)
    expect([written?.value, written?.failed]).toEqual([
        {
            summary: 'Statements do not send',
            description: "Grace's statement was refused. Trace 4bf9.",
        },
        false,
    ])
})
