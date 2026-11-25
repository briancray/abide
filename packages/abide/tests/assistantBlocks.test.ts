// 44.2, 44.38, 44.51, 44.105, 53.28, 53.32 — WHAT THE MODEL SAID IS HELD AS THE MESSAGES API HOLDS IT:
// its events as the API streamed them, the messages they amount to accumulated as the API's own clients
// accumulate them, and a conversation so held going back to the API exactly as it was.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { claudeApi } from '#server/claudeApi.ts'
import type {
    AssistantEvent,
    AssistantMessage,
} from '#shared/AssistantEvent.ts'
import { assistantMessage } from '#shared/assistantMessage.ts'
import type { ChatCall } from '#shared/callsOf.ts'
import { chat } from '#shared/chat.ts'
import { resultsOf } from '#shared/resultsOf.ts'
import { POST, type Rpc } from '#shared/rpc.ts'

import { CITATION } from './fixtures/assistant/CITATION.ts'
import { CITED_EVENTS } from './fixtures/assistant/CITED_EVENTS.ts'

const FIXTURES = `${import.meta.dir}/fixtures/assistant/`
const NO_TOOLS = {
    list: [],
    call: () => Promise.resolve({ content: [], isError: false }),
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

// THE REVERT: yield only the events that write a block in `provider.claudeApi` (`message_start`,
// `message_delta` and `message_stop` left out), and the usage — cache counts and all — and why the run
// ended never reach a page: 8 events where 11 are due.
test('provider.claudeApi yields every event the API streams, unchanged — 44.2, 44.11', async () => {
    expect(await answered([{ role: 'user', content: 'my balance?' }])).toEqual(
        CITED_EVENTS,
    )
})

// An answer that called a tool: a run that writes words and a call whose input streams as JSON, what
// the call answered, and a run that cites.
const ANSWER: AssistantEvent[] = [
    {
        type: 'message_start',
        message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
        },
    },
    {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'check' },
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ing' },
    },
    { type: 'content_block_stop', index: 0 },
    {
        type: 'content_block_start',
        index: 1,
        content_block: {
            type: 'tool_use',
            id: 't1',
            name: 'lookup',
            input: {},
        },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"account":' },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"checking"}' },
    },
    { type: 'content_block_stop', index: 1 },
    {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { input_tokens: 1, output_tokens: 3 },
    },
    { type: 'message_stop' },
    {
        type: 'tool_result',
        tool_use_id: 't1',
        content: [{ type: 'text', text: '[4217]' }],
        is_error: false,
        value: [4217],
    },
    {
        type: 'message_start',
        message: {
            id: 'msg_2',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 2, output_tokens: 1 },
        },
    },
    {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: [] },
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'citations_delta', citation: CITATION },
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'is 4217.' },
    },
    { type: 'content_block_stop', index: 0 },
    {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { input_tokens: 2, output_tokens: 4 },
    },
    { type: 'message_stop' },
]

// What `ANSWER` amounts to, as the Messages API holds it.
const ANSWERED: AssistantMessage[] = [
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
                content: [{ type: 'text', text: '[4217]' }],
                is_error: false,
            },
        ],
    },
    {
        role: 'assistant',
        content: [{ type: 'text', text: 'is 4217.', citations: [CITATION] }],
    },
]

// THE REVERTS: read a call's input at `content_block_start` and leave its JSON unread in
// `MessageAccumulator`, and the call goes back with `input: {}` where `{ account: 'checking' }` is due;
// start a citation list of the event's own at a block's start rather than a copy, and the citation is
// written into `ANSWER`'s event too — the next fold of it holds the citation twice.
test('an answer’s events amount to the messages the API holds, a call’s input its JSON and a cited run its citations — 44.105', () => {
    expect(assistantMessage('assistant', ANSWER)).toEqual(ANSWERED)
    expect(assistantMessage('assistant', ANSWER)).toEqual(ANSWERED)
})

// THE REVERT: keep a turn's words alone in `blocksOf`, and the API is handed `checking` and
// `is 4217.` as plain words: no `tool_use`, no `tool_result`, no citations.
test('a conversation held as its messages goes back to the API exactly as it was — 44.38, 53.28', async () => {
    const conversation: AssistantMessage[] = [
        await assistantMessage('user', ['my balance?']),
        ...assistantMessage('assistant', ANSWER),
        await assistantMessage('user', ['and savings?']),
    ]
    await answered(conversation)
    const sent = (await (await fetch(base)).json()) as { messages: unknown }
    expect(sent.messages).toEqual(blocked(conversation))
})

// A call the answer never heard back from — the turn cap reached, or stopped while it ran — goes back
// with neither its `tool_use` nor a `tool_result`, which the API refuses one without the other. THE
// REVERT: leave `settle` out of `assistantMessage`, and the turn carries a call with no result.
test('a call that never answered is left out of what an answer amounts to — 44.105', () => {
    const unanswered = ANSWER.slice(0, 11)
    expect(assistantMessage('assistant', unanswered)).toEqual([
        { role: 'assistant', content: [{ type: 'text', text: 'checking' }] },
    ])
})

// 53.32 — A DELTA EXTENDS THE BLOCK IT LANDS IN, and leaves it the block it was: a page keyed by its
// blocks redraws one block a chunk, not the answer. THE REVERT: copy the answering message's blocks
// after each event `chat` folds, and the block a later delta lands in is a new one — the first
// delta's block, the same words, is no longer the one held.
test('chat folds an answer in place, a block keeping its identity from its first delta to its last — 53.32', async () => {
    let release: () => void = () => {}
    const paused = new Promise<void>((resolve) => {
        release = resolve
    })
    const talk = chat({
        async *ask() {
            yield* ANSWER.slice(0, 3)
            await paused
            yield* ANSWER.slice(3)
        },
    })
    talk.draft.set({ role: 'user', content: 'my balance?' })
    ;(talk.composer.onsubmit as (event: Event) => void)(new Event('submit'))
    while (talk.messages().length < 2) await Bun.sleep(1)
    const first = (talk.messages()[1]?.content as { text: string }[])[0]
    expect(first?.text).toBe('check')
    release()
    while (talk.streaming) await Bun.sleep(1)
    const held = talk.messages()[1]?.content as { text: string }[]
    expect(held[0]).toBe(first)
    expect(first?.text).toBe('checking')
    expect(talk.messages().slice(1)).toEqual(ANSWERED)
})

// 44.51 — WHAT A HANDLER'S CALLS ANSWERED, read off the messages by the tool its surface names it: a
// failed call's left out. THE REVERT: drop `block.is_error !== true` from `resultsOf`, and the refused
// call's words are a value too — `["ada", "refused"]` where `["ada"]` is due.
test('resultsOf reads what a handler’s calls answered off the messages — 44.51', () => {
    const whoami = POST(() => 'ada') as Rpc<string, never>
    whoami.address = '/invoices/whoami'
    const call = (id: string, name: string): AssistantMessage => ({
        role: 'assistant',
        content: [{ type: 'tool_use', id, name, input: {} }],
    })
    const answer = (
        id: string,
        text: string,
        is_error = false,
    ): AssistantMessage => ({
        role: 'user',
        content: [
            {
                type: 'tool_result',
                tool_use_id: id,
                content: [{ type: 'text', text }],
                is_error,
            },
        ],
    })
    expect(
        resultsOf(
            [
                call('a', 'post_invoices_whoami'),
                answer('a', '"ada"'),
                call('b', 'web_search'),
                answer('b', '"elsewhere"'),
                call('c', 'post_invoices_whoami'),
                answer('c', '"refused"', true),
            ],
            whoami,
        ),
    ).toEqual(['ada'])
})

// 53.109, 44.106 — A CONVERSATION'S CALLS TO ONE HANDLER, live: a call shows as its block starts, with
// the input its JSON streamed, running until a result answers it, its value then the one the
// `tool_result` event delivered — here a value its words do not spell, so it is not read back from
// them — and a failed call's none. `resultsOf` reads the same calls: off the folded answer the
// delivered value, and off the same messages stored and read back, with no event behind them, the
// words alone. THE REVERTS: drop `delivered.set` from `MessageAccumulator`, and the call's value is
// `undefined` where `4217` is due; drop `streaming` from `callsOf`'s record, and the running call
// reads as settled.
test('chat hands back the calls to one handler, live, each value as its event delivered it — 53.109, 44.106', async () => {
    const balance = POST((args: { account: string }) => args.account.length)
    balance.address = '/accounts/balance'
    const run = (id: string, input: string): AssistantEvent[] => [
        {
            type: 'message_start',
            message: {
                id: `msg_${id}`,
                type: 'message',
                role: 'assistant',
                model: 'claude-opus-5-5',
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 1 },
            },
        },
        {
            type: 'content_block_start',
            index: 0,
            content_block: {
                type: 'tool_use',
                id,
                name: 'post_accounts_balance',
                input: {},
            },
        },
        {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: input },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
    ]
    const events: AssistantEvent[] = [
        ...run('t1', '{"account":"checking"}'),
        {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [{ type: 'text', text: 'checking holds 4217' }],
            is_error: false,
            value: 4217,
        },
        ...run('t2', '{"account":"closed"}'),
        {
            type: 'tool_result',
            tool_use_id: 't2',
            content: [{ type: 'text', text: 'no such account' }],
            is_error: true,
            value: undefined,
        },
    ]
    let release: () => void = () => {}
    const paused = new Promise<void>((resolve) => {
        release = resolve
    })
    const talk = chat({
        async *ask() {
            yield* events.slice(0, 5)
            await paused
            yield* events.slice(5)
        },
    })
    talk.draft.set({ role: 'user', content: 'my balances?' })
    talk.submit()
    while (talk.messages().length < 2) await Bun.sleep(1)
    const read = (calls: ChatCall<{ account: string }, number>[]) =>
        calls.map(({ input, value, failed, streaming }) => ({
            input,
            value,
            failed,
            streaming,
        }))
    expect(read(talk.calls(balance))).toEqual([
        {
            input: { account: 'checking' },
            value: undefined,
            failed: false,
            streaming: true,
        },
    ])
    release()
    while (talk.streaming) await Bun.sleep(1)
    expect(read(talk.calls(balance))).toEqual([
        {
            input: { account: 'checking' },
            value: 4217,
            failed: false,
            streaming: false,
        },
        {
            input: { account: 'closed' },
            value: undefined,
            failed: true,
            streaming: false,
        },
    ])
    expect(resultsOf(assistantMessage('assistant', events), balance)).toEqual([
        4217,
    ])
    expect(resultsOf(structuredClone(talk.messages()), balance)).toEqual([])
})
