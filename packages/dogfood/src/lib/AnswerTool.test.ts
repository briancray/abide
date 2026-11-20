// AN ANSWER AS IT STREAMS THROUGH `Chat`, the way `Ask.abide` hands it over: a docs tool read and
// then answered, and words carrying a `show` block, each rendered by the docs' own pieces.

import { expect, test } from 'bun:test'

import { type AssistantEvent, flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ScriptedAnswer from './ScriptedAnswer.abide'

const NO_HANDLER = undefined

// THE REVERT: read `part.result` once at setup in `AnswerTool` — the line stays `Reading the docs:
// page…` after the tool answered.
test('a docs tool reads as being read, then as read, and the words after it render — 40.28', async () => {
    const steps: (() => void)[] = []
    const step = () => new Promise<void>((go) => steps.push(go))
    async function* ask(): AsyncGenerator<AssistantEvent> {
        yield {
            type: 'tool',
            id: 't1',
            name: 'mcp__app__post_ask_tools_page',
            handler: NO_HANDLER,
        }
        await step()
        yield {
            type: 'result',
            id: 't1',
            text: 'the page',
            failed: false,
            handler: NO_HANDLER,
            value: undefined,
        }
        yield {
            type: 'text',
            text: 'Read it here:\n\n```show page="/reactive/watch"\n```\n',
        }
        await step()
        yield { type: 'done', stop: 'end_turn', usage: { input: 0, output: 0 } }
    }
    const settled = async () => {
        for (let turn = 0; turn < 5; turn += 1) await Bun.sleep(0)
        flushSync()
    }
    using _chat = await mount(ScriptedAnswer({ ask }))
    const input = document.querySelector(
        '[data-part=input]',
    ) as HTMLTextAreaElement
    input.value = 'How do I watch a value?'
    input.dispatchEvent(new Event('input'))
    flushSync()
    document
        .querySelector('[data-part=composer]')
        ?.dispatchEvent(new Event('submit', { cancelable: true }))
    await settled()
    const line = () =>
        document.querySelector('[data-part=tool] .status')?.textContent
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

// THE REVERT: drop `streaming` from `AnswerText`'s `Markdown` — the answer shows `Use **bo` mid-word.
test('an answer leaves out what it is still writing until the turn ends — 52.50', async () => {
    const steps: (() => void)[] = []
    const step = () => new Promise<void>((go) => steps.push(go))
    async function* ask(): AsyncGenerator<AssistantEvent> {
        yield { type: 'text', text: 'Use **bo' }
        await step()
        yield { type: 'text', text: 'ld** and [the do' }
        await step()
        yield { type: 'done', stop: 'end_turn', usage: { input: 0, output: 0 } }
    }
    const settled = async () => {
        for (let turn = 0; turn < 5; turn += 1) await Bun.sleep(0)
        flushSync()
    }
    using _chat = await mount(ScriptedAnswer({ ask }))
    const input = document.querySelector(
        '[data-part=input]',
    ) as HTMLTextAreaElement
    input.value = 'How?'
    input.dispatchEvent(new Event('input'))
    flushSync()
    document
        .querySelector('[data-part=composer]')
        ?.dispatchEvent(new Event('submit', { cancelable: true }))
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
