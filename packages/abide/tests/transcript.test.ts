// 53.24-53.30 — HOW A STREAMED ANSWER FOLDS INTO A TURN, and what a conversation sends. What `chat`
// renders from it is the CRM's tests', which mount it.

import { expect, test } from 'bun:test'

import type { AssistantEvent } from '#shared/AssistantEvent.ts'
import { fold } from '#shared/transcript/fold.ts'
import { messages } from '#shared/transcript/messages.ts'
import { turn } from '#shared/transcript/turn.ts'

test('an answer folds into one turn: words joined, each call paired with its input and result — 53.24-53.27', () => {
    const answering = turn('assistant')
    const events: AssistantEvent[] = [
        { type: 'text', text: 'Looking ' },
        { type: 'text', text: 'Ada up.' },
        { type: 'tool', id: 't1', name: 'searchContacts', handler: undefined },
        { type: 'tool', id: 't2', name: 'listDeals', handler: undefined },
        { type: 'input', id: 't1', input: { name: 'Ada' } },
        {
            type: 'result',
            id: 't1',
            text: '[]',
            failed: false,
            handler: undefined,
            value: [],
        },
        { type: 'text', text: 'Ada is at Analytical Engines.' },
        {
            type: 'permission',
            id: 'p1',
            name: 'Bash',
            input: { command: 'ls' },
        },
        { type: 'done', stop: 'end_turn', usage: { input: 1, output: 2 } },
    ]
    for (const event of events) fold(answering, event)
    expect(answering).toEqual({
        role: 'assistant',
        stop: 'end_turn',
        failed: undefined,
        parts: [
            { type: 'text', text: 'Looking Ada up.' },
            {
                type: 'tool',
                id: 't1',
                name: 'searchContacts',
                input: { name: 'Ada' },
                result: '[]',
                failed: false,
                value: [],
            },
            {
                type: 'tool',
                id: 't2',
                name: 'listDeals',
                input: undefined,
                result: undefined,
                failed: false,
                value: undefined,
            },
            { type: 'text', text: 'Ada is at Analytical Engines.' },
            {
                type: 'permission',
                id: 'p1',
                name: 'Bash',
                input: { command: 'ls' },
                allowed: undefined,
            },
        ],
    })
})

// THE REVERT: rebuild the text part per chunk (`parts[at] = { type: 'text', text: last.text + … }`)
// and a reader of the part sees a fresh object per chunk — 1 part identity becomes 50.
test('a run of text grows one part in place — 53.24', () => {
    const answering = turn('assistant')
    fold(answering, { type: 'text', text: 'a' })
    const part = answering.parts[0]
    for (let at = 0; at < 49; at++) fold(answering, { type: 'text', text: 'a' })
    expect(answering.parts).toHaveLength(1)
    expect(answering.parts[0]).toBe(part as never)
    expect((part as { text: string }).text).toHaveLength(50)
})

test('a conversation sends its words and images, and leaves out an answer with none — 53.28, 53.29', () => {
    const image = {
        type: 'image' as const,
        data: 'AAAA',
        mimeType: 'image/png',
    }
    expect(
        messages([
            turn('user', [{ type: 'text', text: 'Who is this?' }]),
            turn('assistant', [{ type: 'text', text: 'Ada.' }]),
            turn('user', [image, { type: 'text', text: 'And this card?' }]),
            turn('assistant'),
        ]),
    ).toEqual([
        { role: 'user', content: 'Who is this?' },
        { role: 'assistant', content: 'Ada.' },
        {
            role: 'user',
            content: [image, { type: 'text', text: 'And this card?' }],
        },
    ])
})

test('a turn sets every field it declares — 53.30', () => {
    expect(Object.keys(turn('user'))).toEqual([
        'role',
        'parts',
        'stop',
        'failed',
    ])
})
