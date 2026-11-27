// THE CRM'S CONVERSATION over `chat`, held to what a card cannot show: the keys the composer takes
// and refuses, Stop, a permission prompt answered, and the work a streamed answer does per chunk.
// Each `ask` here is a stream the test feeds, so no model and no app is in it.

import { expect, test } from 'bun:test'

import type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from '@abide/abide'
import { chat, flushSync, reactive } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import { attachContactCard } from './attachContactCard.ts'
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
    const push = (event: AssistantEvent) =>
        settle({ value: event, done: false })
    return {
        asked,
        push,
        /** A run opening with a text block, as the Messages API starts one. */
        start: () => {
            push({
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
            })
            push({
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
            })
        },
        /** Words the open text block grows by. */
        say: (text: string) =>
            push({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text },
            }),
        end: () => settle({ value: undefined, done: true }),
        ask(
            { messages }: { messages: AssistantMessage[] },
            options: { signal: AbortSignal },
        ): AsyncIterable<AssistantEvent> {
            asked.push(structuredClone(messages))
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

/** What the person wrote, as `chat` sends it. */
const asking = (text: string): AssistantMessage => ({
    role: 'user',
    content: [{ type: 'text', text }],
})

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

async function arrived() {
    await Bun.sleep(0)
    flushSync()
}

const speakers = () =>
    [...document.querySelectorAll('[data-chat=message]')].map((message) =>
        message.getAttribute('data-speaker'),
    )

// THE REVERT: drop the `isComposing` check in `hotkeys`, which reads the composer's Enter, and the
// Enter that picks a word in an input method sends the half-typed question.
test('Enter sends; Shift+Enter and an input method composing do not', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    type('Which company is Ada at?')
    expect(press({ shiftKey: true }).defaultPrevented).toBe(false)
    expect(press({ isComposing: true }).defaultPrevented).toBe(false)
    expect(speakers()).toEqual([])
    expect(press({}).defaultPrevented).toBe(true)
    expect(speakers()).toEqual(['you'])
    expect(stream.asked).toEqual([[asking('Which company is Ada at?')]])
    stream.end()
    await settled()
})

// 32.113 — THE COMPOSER IS EMPTIED BY SENDING. The draft is `chat`'s, spread onto the textarea as
// its `value`, and a textarea shows its property, never that attribute. THE REVERT: make
// `writeControl` return at once, and the question just sent still stands in the box.
test('sending empties the composer', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    type('Which company is Ada at?')
    press({})
    expect(field.value).toBe('')
    stream.end()
    await settled()
})

// THE REVERT: fold every event seen again per chunk in `chat`, the answer rebuilt from them each
// time, and it reads 1,325 event types for 50 chunks where folding each once reads 100.
test('a streamed answer reads each event once, and a chunk rewrites its answer alone', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    type('Summarize the Ledger audit deal.')
    press({})
    stream.start()
    let reads = 0
    const chunk = (text: string): AssistantEvent => {
        const event = { index: 0, delta: { type: 'text_delta', text } }
        Object.defineProperty(event, 'type', {
            get: () => {
                reads += 1
                return 'content_block_delta'
            },
        })
        return event as AssistantEvent
    }
    const CHUNKS = 50
    const written: MutationRecord[] = []
    const watching = new MutationObserver((records) => written.push(...records))
    for (let at = 0; at < CHUNKS; at++) {
        // The second chunk on: the text block exists, and each chunk only grows it.
        if (at === 1)
            watching.observe(document.body, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
            })
        stream.push(chunk(at === CHUNKS - 1 ? 'end.' : 'word '))
        await arrived()
    }
    written.push(...watching.takeRecords())
    watching.disconnect()
    // Once to route it and once to fold it.
    expect(reads).toBeLessThanOrEqual(2 * CHUNKS)
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

// THE REVERT: drop `data-ends` from `chat`'s message part, and the answer that ends reads
// `[false, false]`.
test('Stop ends the answer and keeps what arrived', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    type('Draft a follow-up to Grace.')
    press({})
    stream.start()
    stream.say('Hi Grace,')
    await arrived()
    const section = document.querySelector('section')
    expect(section?.hasAttribute('data-streaming')).toBe(true)
    ;(document.querySelector('[data-chat=stop]') as HTMLButtonElement).click()
    await settled()
    flushSync()
    expect(section?.getAttribute('data-stop')).toBe('stopped')
    const answer = document.querySelectorAll('[data-chat=message]')[1]
    expect(answer?.querySelector('[data-chat=text]')?.textContent).toBe(
        'Hi Grace,',
    )
    expect(section?.hasAttribute('data-streaming')).toBe(false)
    expect(document.querySelector('[data-chat=send]')).not.toBeNull()
    // 49.1, 53.29 — the answer the person can ask again is marked as one that ends.
    expect(
        [...document.querySelectorAll('[data-chat=message]')].map((message) =>
            message.hasAttribute('data-ends'),
        ),
    ).toEqual([false, true])
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
    await arrived()
    const prompt = document.querySelector('[data-chat=permission]')
    expect(prompt?.getAttribute('data-answer')).toBe('waiting')
    ;(prompt?.querySelector('[data-chat=allow]') as HTMLButtonElement).click()
    flushSync()
    expect(answers).toEqual([{ id: 'p1', allow: true }])
    expect(
        document
            .querySelector('[data-chat=permission]')
            ?.getAttribute('data-answer'),
    ).toBe('allowed')
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
    expect(document.querySelector('section')?.hasAttribute('data-failed')).toBe(
        true,
    )
    expect(document.querySelector('[data-chat=failure]')?.textContent).toBe(
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
        stream.say(text)
        await arrived()
        await Bun.sleep(0)
    }
    type('Summarize the Ledger audit deal.')
    press({})
    stream.start()
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
    expect(speakers()).toEqual(['you'])
    expect(document.querySelector('[data-chat=queued]')?.textContent).toContain(
        'And Grace?',
    )
    stream.start()
    stream.say('Analytical Engines.')
    stream.end()
    await settled()
    flushSync()
    expect(speakers()).toEqual(['you', 'assistant', 'you'])
    expect(stream.asked[1]?.at(-1)).toEqual(asking('And Grace?'))
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
    expect(speakers()).toEqual(['you'])
    expect(stream.asked).toHaveLength(1)
})

test('a conversation handed in as messages is shown, and asked about with what follows', async () => {
    const stream = fed()
    const saved = reactive<AssistantMessage[]>([
        { role: 'user', content: 'Which company is Ada at?' },
        { role: 'assistant', content: 'Analytical Engines.' },
    ])
    using _chat = await mount(Chat({ ask: stream.ask, messages: saved }))
    expect(speakers()).toEqual(['you', 'assistant'])
    type('And Grace?')
    press({})
    expect(stream.asked[0]).toHaveLength(3)
    // Bound, the conversation it grows is the caller's.
    expect(saved.peek()).toHaveLength(3)
    stream.end()
    await settled()
})

const png = (name: string) =>
    new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })

const PNG_BLOCK: AssistantContent = {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' },
}

// 53.105, 53.106 — THE DRAFT IS THE USER MESSAGE, in order: a file attached while typing goes after
// the words, and typing on rewrites the words where they stand. THE REVERT: write the input's
// words after every other block in `chat`'s `write`, and the card is sent ahead of the question.
test('a file attached while typing goes after the words, and typing on keeps it there', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    type('Who is on')
    await dropped([png('card.png')])
    type('Who is on this card?')
    expect(
        (document.querySelector('textarea') as HTMLTextAreaElement).value,
    ).toBe('Who is on this card?')
    press({})
    expect(stream.asked[0]?.[0]?.content).toEqual([
        { type: 'text', text: 'Who is on this card?' },
        PNG_BLOCK,
    ])
    stream.end()
    await settled()
})

// 53.105 — A QUESTION PUT BACK IS THE DRAFT: its words in the input, its image attached, and sent
// as it was. THE REVERT: drop `talk.draft = question` from the CRM's `putBack`, and the composer
// stays empty.
test('a question whose answer failed is put back to edit, with what was attached', async () => {
    const asked: AssistantMessage[][] = []
    using _chat = await mount(
        Chat({
            ask: ({ messages }: { messages: AssistantMessage[] }) => {
                asked.push(structuredClone(messages))
                return {
                    [Symbol.asyncIterator]: () => ({
                        next: () =>
                            asked.length === 1
                                ? Promise.reject(
                                      new Error('The CRM is offline.'),
                                  )
                                : Promise.resolve({
                                      value: undefined,
                                      done: true as const,
                                  }),
                    }),
                }
            },
        }),
    )
    await dropped([png('card.png')])
    type('Who is on this card?')
    press({})
    await settled()
    flushSync()
    ;(
        [...document.querySelectorAll('button')].find(
            (button) => button.textContent === 'Edit the question',
        ) as HTMLButtonElement
    ).click()
    flushSync()
    expect(speakers()).toEqual([])
    expect(
        (document.querySelector('textarea') as HTMLTextAreaElement).value,
    ).toBe('Who is on this card?')
    expect(document.querySelectorAll('[data-chat=attachment]')).toHaveLength(1)
    press({})
    await settled()
    expect(asked[1]).toEqual(asked[0])
})

// 49.18 — THE DROPZONE'S PARTS ARE HANDED BACK AS ITS OWN: the picker is `dropzone`'s `input`. THE
// REVERT: hand back as `talk.dropzone` the parts of a second `dropzone` that `chat` never hears, and
// the pick is never taken.
test('a file picked through the dropzone input goes with the next question', async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    const picker = document.querySelector(
        '[data-dropzone=input]',
    ) as HTMLInputElement
    Object.defineProperty(picker, 'files', { value: [png('card.png')] })
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await settled()
    flushSync()
    expect(document.querySelectorAll('[data-chat=attachment]')).toHaveLength(1)
    type('Who is on this card?')
    press({})
    expect(stream.asked[0]?.[0]?.content).toEqual([
        PNG_BLOCK,
        { type: 'text', text: 'Who is on this card?' },
    ])
    stream.end()
    await settled()
})

const card = (name: string, lines: string[]) =>
    new File([lines.join('\n')], name, { type: 'text/vcard' })

// 53.37 — A FILE IS TAKEN AS THE BLOCKS `attach` ANSWERS: a vCard as words, which the input leaves
// alone. THE REVERT: drop `fromFiles` from `chat`'s `typed`, and the card's words land in the input.
test('a contact card is attached as words, apart from what is typed', async () => {
    const stream = fed()
    using _chat = await mount(
        Chat({ ask: stream.ask, attach: attachContactCard }),
    )
    await dropped([
        card('ada.vcf', ['BEGIN:VCARD', 'FN:Ada Lovelace', 'END:VCARD']),
    ])
    expect(
        (document.querySelector('textarea') as HTMLTextAreaElement).value,
    ).not.toContain('Ada')
    expect(document.querySelectorAll('[data-chat=attachment]')).toHaveLength(1)
    type('Which company is she at?')
    press({})
    expect(stream.asked[0]?.[0]?.content).toEqual([
        { type: 'text', text: 'A contact card, ada.vcf:\nFN: Ada Lovelace' },
        { type: 'text', text: 'Which company is she at?' },
    ])
    stream.end()
    await settled()
})

// 53.37 — A FILE TURNED AWAY, AND ONE `attach` THREW ON, ARE NAMED and never sent. THE REVERT:
// swallow what `attach` throws in `chat`'s `take`, as before `onreject`, and only the archive is
// named.
test('a file turned away, or one that cannot be read, is named and never sent', async () => {
    const stream = fed()
    using _chat = await mount(
        Chat({ ask: stream.ask, attach: attachContactCard }),
    )
    await dropped([
        new File(['PK'], 'deals.zip', { type: 'application/zip' }),
        card('blank.vcf', ['BEGIN:VCARD', 'END:VCARD']),
    ])
    expect(document.querySelector('[role=status]')?.textContent).toBe(
        'Not attached: deals.zip, blank.vcf',
    )
    expect(document.querySelector('[data-chat=attachment]')).toBeNull()
})

// 53.108 — A SEND WAITS ON A FILE STILL BEING TAKEN, and goes with it once it lands. THE REVERT:
// drop the `converting` check from `chat`'s `submit`, and the question goes without the photo.
test('a question sent while a file is still being taken waits for it', async () => {
    const stream = fed()
    let land: () => void = () => {}
    const landed = new Promise<void>((resolve) => {
        land = resolve
    })
    using _chat = await mount(
        Chat({
            ask: stream.ask,
            attach: async () => {
                await landed
                return [PNG_BLOCK]
            },
        }),
    )
    type('Who is on this card?')
    await dropped([png('card.png')])
    expect(document.querySelector('form')?.hasAttribute('data-attaching')).toBe(
        true,
    )
    expect(document.querySelector('[data-chat=send]')?.textContent).toBe(
        'Attaching…',
    )
    press({})
    expect(stream.asked).toEqual([])
    land()
    await settled()
    flushSync()
    expect(stream.asked[0]?.[0]?.content).toEqual([
        { type: 'text', text: 'Who is on this card?' },
        PNG_BLOCK,
    ])
    stream.end()
    await settled()
})

// A conversation with a tool call in it: words as a string, an answer that calls a tool between two
// runs of words, and the person's next turn carrying the call's result before their own words.
const CALLED: AssistantMessage[] = [
    { role: 'user', content: 'Who is Grace?' },
    {
        role: 'assistant',
        content: [
            { type: 'text', text: 'Looking her up.' },
            { type: 'tool_use', id: 'call_1', name: 'crm_search', input: {} },
            { type: 'text', text: 'Grace Hopper, at Hopper & Co.' },
        ],
    },
    {
        role: 'user',
        content: [
            {
                type: 'tool_result',
                tool_use_id: 'call_1',
                content: [{ type: 'text', text: '{"hits":1}' }],
            },
            { type: 'text', text: 'And her company?' },
        ],
    },
]

// THE REVERT: drop the `tool_result` check from `chat`'s message `blocks`, and the person's turn
// lists the call's result among its blocks — `['tool_result', 'text']` where `['text']` is due.
test("a message's blocks show in order, words held as a string as one, and no tool_result among them — 53.24", async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask, messages: CALLED }))
    const shown = [...document.querySelectorAll('[data-chat=message]')].map(
        (message) =>
            [
                ...message.querySelectorAll(
                    '[data-chat=text], [data-chat=tool]',
                ),
            ].map((block) =>
                block.getAttribute('data-chat') === 'tool'
                    ? 'a tool'
                    : block.textContent?.trim(),
            ),
    )
    expect(shown).toEqual([
        ['Who is Grace?'],
        ['Looking her up.', 'a tool', 'Grace Hopper, at Hopper & Co.'],
        ['And her company?'],
    ])
    const talk = chat({ ask: stream.ask, messages: reactive(CALLED) })
    const kinds = CALLED.map((message, index) =>
        talk.message(message, index).blocks.map((block) => block.type),
    )
    expect(kinds).toEqual([['text'], ['text', 'tool_use', 'text'], ['text']])
})

// THE REVERT: keep the first `message_delta`'s `stop_reason` in `chat` — `stop = stop ??
// event.delta.stop_reason` — and the answer that called a tool and then ended reads `data-stop:
// tool_use` where `data-stop: end_turn` is due.
test("stop_reason is the latest answer's last message_delta's — 53.27", async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask }))
    const section = () => document.querySelector('section')
    const stopped = (stop_reason: string) =>
        stream.push({
            type: 'message_delta',
            delta: { stop_reason, stop_sequence: null },
            usage: { output_tokens: 0 },
        })
    type('Find Grace.')
    press({})
    stream.start()
    stream.say('Looking.')
    stopped('tool_use')
    stopped('end_turn')
    stream.end()
    await settled()
    flushSync()
    expect(`data-stop: ${section()?.getAttribute('data-stop')}`).toBe(
        'data-stop: end_turn',
    )
    // The next answer starts from none, and ends with none where it carried no `message_delta`.
    type('And Ada?')
    press({})
    stream.start()
    stream.end()
    await settled()
    flushSync()
    expect(section()?.getAttribute('data-stop')).toBeNull()
})

// THE REVERT: write the outcome onto the answer as it ends in `chat` — `messages.patch((all) => {
// Object.assign(all.at(-1) as object, { stop_reason: stop }) })` beside `outcome.set` — and the next
// question asks with an answer carrying `stop_reason` — `assistant: content, role, stop_reason` where
// `assistant: content, role` is due.
test("permissions, stop_reason and failed are the parts' own, never written to the messages — 53.30", async () => {
    const stream = fed()
    using _chat = await mount(Chat({ ask: stream.ask, permit: () => {} }))
    type('Export my contacts.')
    press({})
    stream.start()
    stream.say('Exporting.')
    stream.push({
        type: 'permission',
        id: 'p1',
        name: 'Bash',
        input: { command: 'ls' },
    })
    stream.push({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 0 },
    })
    stream.end()
    await settled()
    flushSync()
    expect(document.querySelector('section')?.getAttribute('data-stop')).toBe(
        'end_turn',
    )
    expect(document.querySelectorAll('[data-chat=permission]')).toHaveLength(1)
    type('Thanks.')
    press({})
    const fields = (stream.asked[1] ?? []).map(
        (message) =>
            `${message.role}: ${Object.keys(message).sort().join(', ')}`,
    )
    expect(fields).toEqual([
        'user: content, role',
        'assistant: content, role',
        'user: content, role',
    ])
    stream.end()
    await settled()
})

// THE REVERT: drop `options.permit === undefined ||` from `chat`'s permission buttons, and a chat
// handed no `permit` offers buttons that answer nothing — `without permit: false, false` where
// `true, true` is due.
test('permission buttons are disabled without permit, and once the prompt is answered — 53.38', async () => {
    const buttons = () =>
        [
            ...document.querySelectorAll<HTMLButtonElement>(
                '[data-chat=permission] button',
            ),
        ].map((button) => button.disabled)
    const asked = async (
        permit?: (answer: { id: string; allow: boolean }) => void,
    ) => {
        const stream = fed()
        const mounted = await mount(Chat({ ask: stream.ask, permit }))
        type('Export my contacts.')
        press({})
        stream.push({
            type: 'permission',
            id: 'p1',
            name: 'Bash',
            input: { command: 'ls' },
        })
        await arrived()
        return { stream, mounted }
    }
    {
        const { stream, mounted } = await asked()
        using _chat = mounted
        expect(`without permit: ${buttons().join(', ')}`).toBe(
            'without permit: true, true',
        )
        stream.end()
        await settled()
    }
    const answers: { id: string; allow: boolean }[] = []
    const { stream, mounted } = await asked((answer) => answers.push(answer))
    using _chat = mounted
    expect(buttons()).toEqual([false, false])
    document.querySelector<HTMLButtonElement>('[data-chat=deny]')?.click()
    flushSync()
    expect([answers, buttons()]).toEqual([
        [{ id: 'p1', allow: false }],
        [true, true],
    ])
    stream.end()
    await settled()
})
