// THE CRM'S `ask`, which every answer `chat` asks goes through: the model is sent the page the
// question was asked on and earlier tool results cut short, and the conversation keeps them whole.

import { expect, test } from 'bun:test'

import type { AssistantMessage } from '@abide/abide'
import { reactive } from '@abide/abide'
import { createApp } from '@abide/abide/server'
import { mount, settled } from '@abide/harness/abide'

import { askAboutThisPage, sentFor } from './askAboutThisPage.ts'
import Chat from './Chat.abide'

/** Types `question` into the composer and sends it with Enter. */
function ask(question: string) {
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    field.value = question
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }),
    )
}

const EARLIER: AssistantMessage[] = [
    { role: 'user', content: 'Which company is Ada at?' },
    {
        role: 'assistant',
        content: [
            {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'searchContacts',
                input: { name: 'Ada' },
            },
        ],
    },
    {
        role: 'user',
        content: [
            {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content:
                    'Ada Lovelace, Analytical Engines, ada@engines.example',
            },
        ],
    },
    { role: 'assistant', content: 'Ada Lovelace is at Analytical Engines.' },
    { role: 'user', content: 'And her email?' },
]

// THE REVERT: hand `askAssistant` the messages as they came, and the earlier result goes whole.
test('the model is sent the page asked on, and earlier tool results cut short', () => {
    const held = structuredClone(EARLIER)
    const sent = sentFor(held, '/contacts')
    expect(sent[2]?.content).toEqual([
        {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'An earlier result, left out.',
        },
    ])
    expect(sent.at(-1)).toEqual({
        role: 'user',
        content: [
            { type: 'text', text: 'Asked on /contacts.' },
            { type: 'text', text: 'And her email?' },
        ],
    })
    // What it was handed is left as it was.
    expect(held).toEqual(EARLIER)
})

// 53.31 — EVERY ANSWER IS ASKED THROUGH `ask`, and what `ask` sends is its own: the conversation
// `chat` keeps holds the search's result whole. THE REVERT: cut the results short in place in
// `sentFor`, and the conversation keeps the cut.
test('the conversation keeps every tool result whole', async () => {
    await using app = await createApp()
    await app.run(
        async () => {
            const thread = reactive<AssistantMessage[]>([])
            using _chat = await mount(
                Chat({ ask: askAboutThisPage, messages: thread }),
            )
            ask('Which company is Ada at?')
            await settled()
            ask('And her email?')
            await settled()
            const results = []
            for (const message of thread.peek() ?? [])
                if (typeof message.content !== 'string')
                    for (const block of message.content)
                        if (block.type === 'tool_result') results.push(block)
            expect(results).toHaveLength(2)
            expect(results[0]?.content).toEqual(results[1]?.content)
            expect(JSON.stringify(results[0]?.content)).toContain('Ada')
        },
        { request: new Request('http://crm.invalid/assistant') },
    )
})
