// ABIDE'S CHAT, held to what a card cannot show: the keys the composer takes and refuses, Stop,
// a permission prompt answered, and the work a streamed answer does per chunk. Each `ask` here is
// a stream the test feeds, so no model and no app is in it.

import { expect, test } from 'bun:test'

import type { AssistantEvent, AssistantMessage } from '@abide/abide'
import { flushSync } from '@abide/abide'
import Chat from '@abide/abide/Chat.abide'
import { mount, settled } from '@abide/harness/abide'

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
    [...document.querySelectorAll('[data-part=turn]')].map((turn) =>
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
test('a streamed answer reads each event once, and a chunk rewrites one text node', async () => {
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
    // One text node rewritten per chunk, and nothing built, moved or reattributed.
    const kinds = new Set(written.map((record) => record.type))
    expect([...kinds]).toEqual(['characterData'])
    expect(written.length).toBeLessThanOrEqual(CHUNKS - 1)
    stream.end()
    await settled()
    const answer = document.querySelectorAll('[data-part=text]')[1]
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
    ;(document.querySelector('[data-part=stop]') as HTMLButtonElement).click()
    await settled()
    flushSync()
    const answer = document.querySelectorAll('[data-part=turn]')[1]
    expect(answer?.getAttribute('data-stop')).toBe('stopped')
    expect(answer?.querySelector('[data-part=text]')?.textContent).toBe(
        'Hi Grace,',
    )
    expect(
        document.querySelector('section')?.hasAttribute('data-streaming'),
    ).toBe(false)
    expect(document.querySelector('[data-part=send]')).not.toBeNull()
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
    const prompt = document.querySelector('[data-part=permission]')
    expect(prompt?.getAttribute('data-answer')).toBe('waiting')
    ;(prompt?.querySelector('[data-part=allow]') as HTMLButtonElement).click()
    flushSync()
    expect(answers).toEqual([{ id: 'p1', allow: true }])
    expect(prompt?.getAttribute('data-answer')).toBe('allowed')
    stream.end()
    await settled()
})

// THE REVERT: drop the `dropzone` from the composer, and the screenshot dropped on it never reaches
// the question.
test('an image dropped on the composer goes with the next question', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    const card = new File([new Uint8Array([137, 80, 78, 71])], 'card.png', {
        type: 'image/png',
    })
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
        value: { types: ['Files'], files: [card], items: [] },
    })
    document.querySelector('form')?.dispatchEvent(drop)
    await settled()
    flushSync()
    expect(document.querySelectorAll('[data-part=attachment]')).toHaveLength(1)
    type('Who is on this card?')
    press({})
    const [message] = stream.asked[0] ?? []
    expect(message?.role).toBe('user')
    expect(message?.content).toEqual([
        { type: 'image', data: 'iVBORw==', mimeType: 'image/png' },
        { type: 'text', text: 'Who is on this card?' },
    ])
    expect(document.querySelector('[data-part=attachment]')).toBeNull()
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
    const answer = document.querySelectorAll('[data-part=turn]')[1]
    expect(answer?.hasAttribute('data-failed')).toBe(true)
    expect(answer?.querySelector('[data-part=failure]')?.textContent).toBe(
        'The CRM is offline.',
    )
    expect(document.querySelector('[data-part=send]')).not.toBeNull()
})

// THE REVERT: drop the `following` check in `followBottom`, and a reader scrolled up to an earlier
// answer is pulled back down by every chunk.
test('the transcript follows its bottom until the reader scrolls up', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    const log = document.querySelector('[data-part=transcript]') as HTMLElement
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
