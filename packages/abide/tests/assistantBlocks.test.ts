// 44.11, 44.38, 44.104, 53.28 — WHAT THE MODEL SAID IS HELD AS THE MESSAGES API HOLDS IT: an answer's
// end under the API's own names, a cited run with its citations, and a conversation folded from its
// events going back to the API as the blocks it was.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { claudeApi } from '#server/claudeApi.ts'
import type {
    AssistantEvent,
    AssistantMessage,
} from '#shared/AssistantEvent.ts'
import { fold } from '#shared/transcript/fold.ts'
import { messages } from '#shared/transcript/messages.ts'
import { turn } from '#shared/transcript/turn.ts'

import { CITATION } from './fixtures/assistant/CITATION.ts'

const FIXTURES = `${import.meta.dir}/fixtures/assistant/`
const NO_TOOLS = {
    list: [],
    call: () => Promise.resolve({ content: [], failed: false }),
}

let api: Bun.Subprocess | undefined
let base = ''

beforeAll(async () => {
    api = Bun.spawn(['bun', `${FIXTURES}fakeCitingApi.ts`], { stdout: 'pipe' })
    let printed = ''
    for await (const chunk of api.stdout as ReadableStream<Uint8Array>) {
        printed += new TextDecoder().decode(chunk)
        if (printed.includes('\n')) break
    }
    base = printed.trim().replace(/\/$/, '')
})

afterAll(() => api?.kill())

const provider = () =>
    claudeApi({
        apiKey: 'key',
        baseURL: base,
        model: 'claude-opus-5-5',
        max_tokens: 1000,
    })

/** Every event `provider.claudeApi` yields for `sent`, each turn's words as one text block. */
async function answered(sent: AssistantMessage[]): Promise<unknown[]> {
    const said: unknown[] = []
    for await (const event of provider().run(blocked(sent), NO_TOOLS, {
        maxTurns: 1,
        signal: new AbortController().signal,
    }))
        said.push(event)
    return said
}

/** Each turn as its blocks, words alone one text block, as `assistant` hands a provider them. */
function blocked(sent: AssistantMessage[]) {
    return sent.map((message) => ({
        role: message.role,
        content:
            typeof message.content === 'string'
                ? [{ type: 'text' as const, text: message.content }]
                : message.content,
    }))
}

// THE REVERTS: stream every text delta as it arrives in `provider.claudeApi` (`cited` answering
// false), and the cited run arrives as two runs with no citations — `is 4217`, `.` — where one carrying
// the page is due; sum only `input_tokens` and `output_tokens`, and the cache counts are gone —
// `cache_read_input_tokens` undefined where 7 is due.
test('an answer ends on the API’s stop_reason and usage, its cache counts with it, and a cited run arrives whole with its citations — 44.11, 44.104', async () => {
    expect(await answered([{ role: 'user', content: 'my balance?' }])).toEqual([
        { type: 'text', text: 'Your balance ' },
        { type: 'text', text: 'is 4217.', citations: [CITATION] },
        {
            type: 'done',
            stop_reason: 'end_turn',
            usage: {
                input_tokens: 4,
                output_tokens: 6,
                cache_creation_input_tokens: 2,
                cache_read_input_tokens: 7,
            },
        },
    ])
})

// THE REVERT: send an answer back as its words alone, its tool calls the server's to remember (the
// `messages` before this change), and the API is handed `checking` and the cited run as two plain
// strings — no `tool_use`, no `tool_result`, no citations.
test('a conversation folded from its events goes back to the API as the blocks it was — 53.28, 44.38', async () => {
    const answering = turn('assistant')
    const events: AssistantEvent[] = [
        { type: 'text', text: 'checking' },
        { type: 'tool', id: 't1', name: 'lookup', handler: undefined },
        { type: 'input', id: 't1', input: { account: 'checking' } },
        {
            type: 'result',
            tool_use_id: 't1',
            content: '[4217]',
            is_error: false,
            handler: undefined,
            value: undefined,
        },
        { type: 'text', text: 'is 4217.', citations: [CITATION] },
        { type: 'text', text: ' Anything else?' },
        {
            type: 'done',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
        },
    ]
    for (const event of events) fold(answering, event)
    const conversation = messages([
        turn('user', [{ type: 'text', text: 'my balance?' }]),
        answering,
        turn('user', [{ type: 'text', text: 'and savings?' }]),
    ])
    expect(conversation).toEqual([
        { role: 'user', content: 'my balance?' },
        {
            role: 'assistant',
            content: [
                { type: 'text', text: 'checking' },
                {
                    type: 'tool_use',
                    id: 't1',
                    name: 'lookup',
                    input: { account: 'checking' },
                },
            ],
        },
        {
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: 't1',
                    content: '[4217]',
                    is_error: false,
                },
            ],
        },
        {
            role: 'assistant',
            content: [
                { type: 'text', text: 'is 4217.', citations: [CITATION] },
                { type: 'text', text: ' Anything else?' },
            ],
        },
        { role: 'user', content: 'and savings?' },
    ])
    await answered(conversation)
    const sent = (await (await fetch(base)).json()) as {
        messages: unknown
    }
    expect(sent.messages).toEqual(blocked(conversation))
})

// A call the answer never heard back from — stopped while it ran — goes back with neither its
// `tool_use` nor a `tool_result`, which the API refuses one without the other. THE REVERT: send every
// tool part as a `tool_use` whether it answered or not, and the turn carries a call with no result.
test('a call that never answered goes back as neither its call nor its result — 53.28', () => {
    const answering = turn('assistant')
    fold(answering, { type: 'text', text: 'looking' })
    fold(answering, {
        type: 'tool',
        id: 't1',
        name: 'lookup',
        handler: undefined,
    })
    answering.stop_reason = 'stopped'
    expect(messages([answering])).toEqual([
        { role: 'assistant', content: 'looking' },
    ])
})
