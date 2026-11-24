// AN ANSWER AS IT STREAMS THROUGH `Conversation`, as `Ask.abide` mounts it: a docs tool read and
// then answered, and words carrying a `show` block, each rendered by the docs' own pieces.

import { expect, test } from 'bun:test'

import { type AssistantEvent, flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import Conversation from './Conversation.abide'

/** A run's opening, as the Messages API streams it. */
const START: AssistantEvent = {
    type: 'message_start',
    message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
    },
}

/** A text block at `index` opened, and the words it starts with. */
function words(index: number, text: string): AssistantEvent[] {
    return [
        {
            type: 'content_block_start',
            index,
            content_block: { type: 'text', text: '' },
        },
        more(index, text),
    ]
}

/** Words the text block at `index` grows by. */
function more(index: number, text: string): AssistantEvent {
    return {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text },
    }
}

const settled = async () => {
    for (let turn = 0; turn < 5; turn += 1) await Bun.sleep(0)
    flushSync()
}

/** Writes `question` in the composer and sends it. */
function send(question: string) {
    const input = document.querySelector(
        '[data-chat=input]',
    ) as HTMLTextAreaElement
    input.value = question
    input.dispatchEvent(new Event('input'))
    flushSync()
    document
        .querySelector('[data-chat=composer]')
        ?.dispatchEvent(new Event('submit', { cancelable: true }))
}

// THE REVERT: hand `AnswerTool` whether the call was answered once, at setup, in `Conversation` —
// the line stays `Reading the docs: page…` after the tool answered.
test('a docs tool reads as being read, then as read, and the words after it render — 40.28', async () => {
    const steps: (() => void)[] = []
    const step = () => new Promise<void>((go) => steps.push(go))
    async function* ask(): AsyncGenerator<AssistantEvent> {
        yield START
        yield {
            type: 'content_block_start',
            index: 0,
            content_block: {
                type: 'tool_use',
                id: 't1',
                name: 'mcp__app__post_ask_tools_page',
                input: {},
            },
        }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_stop' }
        await step()
        yield {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [{ type: 'text', text: 'the page' }],
            is_error: false,
            value: undefined,
        }
        yield START
        yield* words(
            0,
            'Read it here:\n\n```show page="/reactive/watch"\n```\n',
        )
        await step()
    }
    using _chat = await mount(Conversation({ ask }))
    send('How do I watch a value?')
    await settled()
    const line = () =>
        document.querySelector('[data-chat=tool] .status')?.textContent
    expect(line()).toBe('Reading the docs: page…')
    steps.shift()?.()
    await settled()
    expect(line()).toBe('Read the docs: page')
    expect(document.querySelector('a.shown-page span')?.textContent).toBe(
        'Read',
    )
    steps.shift()?.()
    await settled()
})

// THE REVERT: drop `streaming` from `AnswerText`'s `markdown.incremental` — the answer shows `Use **bo` mid-word.
test('an answer leaves out what it is still writing until the turn ends — 52.50', async () => {
    const steps: (() => void)[] = []
    const step = () => new Promise<void>((go) => steps.push(go))
    async function* ask(): AsyncGenerator<AssistantEvent> {
        yield START
        yield* words(0, 'Use **bo')
        await step()
        yield more(0, 'ld** and [the do')
        await step()
    }
    using _chat = await mount(Conversation({ ask }))
    send('How?')
    await settled()
    const answer = () =>
        document.querySelector('[data-speaker=assistant] .flow')?.textContent
    expect(answer()).toBe('Use')
    steps.shift()?.()
    await settled()
    expect(answer()).toBe('Use bold and')
    steps.shift()?.()
    await settled()
    // Ended: what never closed is shown as it was written.
    expect(answer()).toBe('Use bold and [the do')
})
