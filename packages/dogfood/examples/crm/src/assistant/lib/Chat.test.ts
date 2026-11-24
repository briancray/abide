// THE CRM'S CONVERSATION over `chat`, held to what a card cannot show: the keys the composer takes
// and refuses, Stop, a permission prompt answered, and the work a streamed answer does per chunk.
// Each `ask` here is a stream the test feeds, so no model and no app is in it.

import { expect, test } from 'bun:test'

import type { AssistantEvent, AssistantMessage } from '@abide/abide'
import { flushSync, reactive } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import Chat from './Chat.abide'

/** A stream the test writes to: what the chat was asked, and each event as the test pushes it. */
function fed() {
    const asked: AssistantMessage[][] = []
    const waiting: ((event: IteratorResult<AssistantEvent>) => void)[] = []
    const queued: IteratorResult<AssistantEvent>[] = []
    let signal: AbortSignal | undefined
    const settle = (result: IteratorResult<AssistantEvent>) => {
        const reader = waiting.shift()
        if (reader) reader(result)
        else queued.push(result)
    }
    return {
        asked,
        push: (event: AssistantEvent) => settle({ value: event, done: false }),
        end: () => settle({ value: undefined, done: true }),
        ask(
            { messages }: { messages: AssistantMessage[] },
            options: { signal: AbortSignal },
        ): AsyncIterable<AssistantEvent> {
            asked.push(messages)
            signal = options.signal
            return {
                [Symbol.asyncIterator]: () => ({
                    next: () =>
                        new Promise<IteratorResult<AssistantEvent>>(
                            (resolve, reject) => {
                                const result = queued.shift()
                                if (result) return resolve(result)
                                waiting.push(resolve)
                                signal?.addEventListener('abort', () =>
                                    reject(new DOMException('aborted')),
                                )
                            },
                        ),
                }),
            }
        },
    }
}

function type(words: string) {
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    field.value = words
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function press(init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...init,
    })
    document.querySelector('textarea')?.dispatchEvent(event)
    flushSync()
    return event
}

const turns = () =>
    [...document.querySelectorAll('[data-chat=turn]')].map((turn) =>
        turn.getAttribute('data-speaker'),
    )

// THE REVERT: drop the `isComposing` check in `hotkeys`, which reads the composer's Enter, and the
// Enter that picks a word in an input method sends the half-typed question.
test('Enter sends; Shift+Enter and an input method composing do not', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    type('Which company is Ada at?')
    expect(press({ shiftKey: true }).defaultPrevented).toBe(false)
    expect(press({ isComposing: true }).defaultPrevented).toBe(false)
    expect(turns()).toEqual([])
    expect(press({}).defaultPrevented).toBe(true)
    expect(turns()).toEqual(['you', 'assistant'])
    expect(stream.asked).toEqual([
        [{ role: 'user', content: 'Which company is Ada at?' }],
    ])
    stream.end()
    await settled()
})

// THE REVERT: hold the events in an array and fold all of them again per chunk (`answering.parts =
// []; for (const each of seen) transcript.fold(answering, each)`), and the answer reads 1,275 events
// for 50 chunks where folding each once reads 50.
test('a streamed answer reads each event once, and a chunk rewrites its answer alone', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    type('Summarize the Ledger audit deal.')
    press({})
    let reads = 0
    const chunk = (text: string): AssistantEvent => {
        const event = { text } as { type: 'text'; text: string }
        Object.defineProperty(event, 'type', {
            get: () => {
                reads += 1
                return 'text'
            },
        })
        return event
    }
    const CHUNKS = 50
    const written: MutationRecord[] = []
    const watching = new MutationObserver((records) => written.push(...records))
    for (let at = 0; at < CHUNKS; at++) {
        // The second chunk on: the text part exists, and each chunk only grows it.
        if (at === 1)
            watching.observe(document.body, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
            })
        stream.push(chunk(at === CHUNKS - 1 ? 'end.' : 'word '))
        await Bun.sleep(0)
        flushSync()
    }
    written.push(...watching.takeRecords())
    watching.disconnect()
    expect(reads).toBeLessThanOrEqual(CHUNKS)
    // Each chunk rewrites the answer's markdown alone: nothing outside it is built, moved or
    // reattributed.
    const answer = document.querySelectorAll('[data-chat=text]')[1]
    const outside = written.filter(
        (record) =>
            record.type === 'attributes' || !answer?.contains(record.target),
    )
    expect(outside).toEqual([])
    // And within it, the section still growing: one paragraph built per chunk.
    let built = 0
    for (const record of written)
        for (const node of record.addedNodes)
            if (node.nodeType === Node.ELEMENT_NODE) built += 1
    expect(built).toBeLessThanOrEqual(CHUNKS - 1)
    stream.end()
    await settled()
    expect(answer?.textContent).toBe(`${'word '.repeat(CHUNKS - 1)}end.`)
})

test('Stop ends the answer and keeps what arrived', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    type('Draft a follow-up to Grace.')
    press({})
    stream.push({ type: 'text', text: 'Hi Grace,' })
    await Bun.sleep(0)
    flushSync()
    expect(
        document.querySelector('section')?.hasAttribute('data-streaming'),
    ).toBe(true)
    ;(document.querySelector('[data-chat=stop]') as HTMLButtonElement).click()
    await settled()
    flushSync()
    const answer = document.querySelectorAll('[data-chat=turn]')[1]
    expect(answer?.getAttribute('data-stop')).toBe('stopped')
    expect(answer?.querySelector('[data-chat=text]')?.textContent).toBe(
        'Hi Grace,',
    )
    expect(
        document.querySelector('section')?.hasAttribute('data-streaming'),
    ).toBe(false)
    expect(document.querySelector('[data-chat=send]')).not.toBeNull()
})

test('a permission prompt is answered through permit', async () => {
    const stream = fed()
    const answers: { id: string; allow: boolean }[] = []
    using _chat = await mount(
        Chat({
            ask: stream.ask,
            permit: (answer: { id: string; allow: boolean }) => {
                answers.push(answer)
            },
        }),
    )
    type('Export my contacts.')
    press({})
    stream.push({
        type: 'permission',
        id: 'p1',
        name: 'Bash',
        input: { command: 'ls' },
    })
    await Bun.sleep(0)
    flushSync()
    const prompt = document.querySelector('[data-chat=permission]')
    expect(prompt?.getAttribute('data-answer')).toBe('waiting')
    ;(prompt?.querySelector('[data-chat=allow]') as HTMLButtonElement).click()
    flushSync()
    expect(answers).toEqual([{ id: 'p1', allow: true }])
    expect(prompt?.getAttribute('data-answer')).toBe('allowed')
    stream.end()
    await settled()
})

/** Drops `files` on the composer, as a drag from the desktop would. */
async function dropped(files: File[]) {
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
        value: { types: ['Files'], files, items: [] },
    })
    document.querySelector('form')?.dispatchEvent(drop)
    await settled()
    flushSync()
}

// THE REVERT: drop the `dropzone` from the composer, and the screenshot dropped on it never reaches
// the question.
test('an image dropped on the composer goes with the next question', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    await dropped([
        new File([new Uint8Array([137, 80, 78, 71])], 'card.png', {
            type: 'image/png',
        }),
    ])
    expect(document.querySelectorAll('[data-chat=attachment]')).toHaveLength(1)
    type('Who is on this card?')
    press({})
    const [message] = stream.asked[0] ?? []
    expect(message?.role).toBe('user')
    expect(message?.content).toEqual([
        {
            type: 'image',
            source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw==',
            },
        },
        { type: 'text', text: 'Who is on this card?' },
    ])
    expect(document.querySelector('[data-chat=attachment]')).toBeNull()
    stream.end()
    await settled()
})

// THE REVERT: hand the composer's dropzone an image's accept alone, as before documents, and the
// statement is turned away — no attachment, and the question goes without it.
test('a PDF dropped on the composer goes with the next question as a document', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    await dropped([
        new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' }),
    ])
    expect(
        document.querySelector('[data-chat=attachment]')?.textContent,
    ).toContain('statement.pdf')
    type('What does this owe?')
    press({})
    const [message] = stream.asked[0] ?? []
    expect(message?.content).toEqual([
        {
            type: 'document',
            source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: btoa('%PDF'),
            },
            title: 'statement.pdf',
        },
        { type: 'text', text: 'What does this owe?' },
    ])
    stream.end()
    await settled()
})

test('an answer that fails says why, and the composer sends again', async () => {
    using _chat = await mount(
        Chat({
            ask: () => ({
                [Symbol.asyncIterator]: () => ({
                    next: () =>
                        Promise.reject(new Error('The CRM is offline.')),
                }),
            }),
        }),
    )
    type('Which company is Ada at?')
    press({})
    await settled()
    flushSync()
    const answer = document.querySelectorAll('[data-chat=turn]')[1]
    expect(answer?.hasAttribute('data-failed')).toBe(true)
    expect(answer?.querySelector('[data-chat=failure]')?.textContent).toBe(
        'The CRM is offline.',
    )
    expect(document.querySelector('[data-chat=send]')).not.toBeNull()
})

// THE REVERT: drop the `following` check in `autoscroll`, and a reader scrolled up to an earlier
// answer is pulled back down by every chunk.
test('the transcript follows its bottom until the reader scrolls up', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    const log = document.querySelector('[data-chat=transcript]') as HTMLElement
    expect(log.getAttribute('role')).toBe('log')
    expect(log.getAttribute('aria-live')).toBe('polite')
    // The emulator lays nothing out: the transcript is 100px tall and grows 40px a chunk.
    let height = 100
    Object.defineProperty(log, 'clientHeight', { get: () => 100 })
    Object.defineProperty(log, 'scrollHeight', { get: () => height })
    const chunk = async (text: string) => {
        height += 40
        stream.push({ type: 'text', text })
        await Bun.sleep(0)
        flushSync()
        await Bun.sleep(0)
    }
    type('Summarize the Ledger audit deal.')
    press({})
    await chunk('Three-year term, ')
    expect(log.scrollTop).toBe(height)
    log.scrollTop = 0
    log.dispatchEvent(new Event('scroll'))
    await chunk('signed in March.')
    expect(log.scrollTop).toBe(0)
    stream.end()
    await settled()
})

// THE REVERT: refuse a send while an answer streams, and the follow-up typed during it is lost.
test('a question sent while an answer streams is queued, and asked once the answer ends', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    type('Which company is Ada at?')
    press({})
    type('And Grace?')
    press({})
    expect(turns()).toEqual(['you', 'assistant'])
    expect(document.querySelector('[data-chat=queued]')?.textContent).toContain(
        'And Grace?',
    )
    stream.push({ type: 'text', text: 'Analytical Engines.' })
    stream.end()
    await settled()
    flushSync()
    expect(turns()).toEqual(['you', 'assistant', 'you', 'assistant'])
    expect(stream.asked[1]?.at(-1)).toEqual({
        role: 'user',
        content: 'And Grace?',
    })
    expect(document.querySelector('[data-chat=queued]')).toBeNull()
    stream.end()
    await settled()
})

test('a queued question cancelled is never asked', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    type('Which company is Ada at?')
    press({})
    type('And Grace?')
    press({})
    ;(document.querySelector('[data-chat=cancel]') as HTMLButtonElement).click()
    flushSync()
    expect(document.querySelector('[data-chat=queued]')).toBeNull()
    stream.end()
    await settled()
    flushSync()
    expect(turns()).toEqual(['you', 'assistant'])
    expect(stream.asked).toHaveLength(1)
})

test('a conversation handed in as turns is shown, and asked about with what follows', async () => {
    const stream = fed()
    const saved = reactive([
        {
            role: 'user' as const,
            parts: [
                { type: 'text' as const, text: 'Which company is Ada at?' },
            ],
            stop_reason: undefined,
            failed: undefined,
        },
        {
            role: 'assistant' as const,
            parts: [{ type: 'text' as const, text: 'Analytical Engines.' }],
            stop_reason: 'end' as const,
            failed: undefined,
        },
    ])
    using _chat = await mount(Chat({ ask: stream.ask, turns: saved }))
    expect(turns()).toEqual(['you', 'assistant'])
    type('And Grace?')
    press({})
    expect(stream.asked[0]).toHaveLength(3)
    // Bound, the conversation it grows is the caller's.
    expect(saved.peek()).toHaveLength(4)
    stream.end()
    await settled()
})
