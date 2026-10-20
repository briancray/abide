import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { clientTags } from '#server/answerRequest.ts'
import { type AssistantEvent, assistant } from '#server/assistant.ts'
import { inScope } from '#server/requestScope.ts'
import { log } from '#shared'
import { APP_META } from '#shared/APP_META.ts'
import { DEBUG_META } from '#shared/DEBUG_META.ts'
import { documentDebug, namedLogger } from '#shared/log.ts'

// Every line reaches the console as well as the records, and a test's output is not where it
// should land.
let written: string[] = []
const restore: (() => void)[] = []
const saved = {
    DEBUG: process.env.DEBUG,
    APP_NAME: process.env.APP_NAME,
    FORMAT: process.env.ABIDE_LOG_FORMAT,
}

beforeEach(() => {
    written = []
    for (const method of ['log', 'warn', 'error'] as const) {
        const spy = spyOn(console, method).mockImplementation(
            (line: string) => {
                written.push(line)
            },
        )
        restore.push(() => spy.mockRestore())
    }
    process.env.APP_NAME = 'ledger'
    process.env.ABIDE_LOG_FORMAT = 'json'
    delete process.env.DEBUG
})

afterEach(() => {
    for (const undo of restore.splice(0)) undo()
    for (const [name, value] of [
        ['DEBUG', saved.DEBUG],
        ['APP_NAME', saved.APP_NAME],
        ['ABIDE_LOG_FORMAT', saved.FORMAT],
    ] as const)
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
})

// 28.1 — EVERY LINE IS APPENDED TO `log.records`, an array, the gated ones included once they pass.
// THE REVERT: drop the `patch` from `write`; the records end on neither of the 2 lines the console got.
test('every written line is appended to the log.records array — 28.1', () => {
    log('booted')
    log.warning('disk', 91)
    const held = log.records.peek() ?? []
    expect(Array.isArray(held)).toBe(true)
    expect(held.slice(-2).map((record) => record.message)).toEqual([
        'booted',
        'disk 91',
    ])
    const last = held.at(-1)
    expect(last?.level).toBe('warning')
    expect(last?.namespace).toBe('ledger')
    expect(written.length).toBe(2)
})

// 28.2, 28.3 — THE BARE CALL, WARNINGS AND ERRORS ALWAYS WRITE; `info` and `debug` wait on `DEBUG`.
// THE REVERT: gate the bare call on `isEnabled`; with `DEBUG` unset, 1 line is written of the 3.
test('log, log.warning and log.error always write; info and debug are gated — 28.2, 28.3', () => {
    log('a')
    log.warning('b')
    log.error('c')
    log.info('d')
    log.debug('e')
    expect(written.length).toBe(3)
    process.env.DEBUG = 'ledger'
    log.info('d')
    log.debug('e')
    expect(written.length).toBe(5)
})

// 28.4, 28.5 — `named` PREFIXES THE APP NAME and a second `named` appends a segment, carrying the
// same levels and `enabled`.
test('log.named prefixes the app name, and again appends — 28.4, 28.5', () => {
    const db = log.named('db')
    const pool = db.named('pool')
    pool.warning('exhausted')
    const record = JSON.parse(written.at(-1) as string)
    expect(record.namespace).toBe('ledger:db:pool')
    expect(typeof pool.enabled).toBe('function')
    expect(typeof pool.debug).toBe('function')
})

// 28.12 — THE PREFIX IS READ PER LINE. A module names its logger at load, which is before the server's
// `config` has derived the app's name, so a prefix taken then is the `app` fallback forever after.
// THE REVERT: take `namespaceOf()` once in `logger.named`; the line reads `ledger:db` where
// `books:db` is due.
test('a logger named before the app name changes writes under the new name — 28.12', () => {
    const early = log.named('db')
    process.env.APP_NAME = 'books'
    early.warning('late')
    expect(JSON.parse(written.at(-1) as string).namespace).toBe('books:db')
})

// 28.6, 28.9 — `DEBUG` IN debug-npm GRAMMAR: a wildcard, a list, and an exclusion that beats an
// inclusion. THE REVERT: test the inclusions before the exclusions in `isEnabled`; `ledger:db` then
// answers open under `ledger:*,-ledger:db`.
test('log.enabled answers DEBUG in debug-npm grammar — 28.6, 28.9', () => {
    process.env.DEBUG = 'ledger:*,-ledger:db'
    expect(log.named('http').enabled()).toBe(true)
    expect(log.named('db').enabled()).toBe(false)
    expect(log.enabled()).toBe(false)
    process.env.DEBUG = 'ledger ledger:db'
    expect(log.enabled()).toBe(true)
    expect(log.named('db').enabled()).toBe(true)
    expect(namedLogger('abide:request').enabled()).toBe(false)
})

// 36.8 — THE MACHINE FORMAT IS ONE LINE A RECORD. tsv escapes the newline a message carries rather
// than breaking the line a reader splits on.
test('tsv writes one line per record — 36.8', () => {
    process.env.ABIDE_LOG_FORMAT = 'tsv'
    log('two\nlines')
    const line = written.at(-1) as string
    expect(line.includes('\n')).toBe(false)
    expect(line.split('\t').slice(1, 3)).toEqual(['info', 'ledger'])
})

// 28.10, 28.11 — `DEBUG` REACHES A BROWSER THROUGH THE DOCUMENT, and the browser's own stored setting
// answers only where the document carries none. THE REVERT: read `localStorage` first in
// `documentDebug`; the stored `other` overrides what the server said.
test("a browser's DEBUG is the document's, then its own stored one — 28.10, 28.11", () => {
    process.env.DEBUG = 'ledger:*'
    const tags = clientTags(
        { entry: 'entry.js', stylesheet: undefined, chunks: {} } as never,
        [],
    )
    expect(tags).toContain(`<meta name="${DEBUG_META}" content="ledger:*">`)

    localStorage.setItem('debug', 'other')
    document.head.innerHTML = ''
    expect(documentDebug()).toBe('other')
    document.head.innerHTML = `<meta name="${DEBUG_META}" content="ledger:*">`
    expect(documentDebug()).toBe('ledger:*')
    document.head.innerHTML = ''
    localStorage.removeItem('debug')
})

// 28.10 — A BROWSER READS THE DOCUMENT'S `DEBUG` ONCE, not per gated line. A document with no
// `DEBUG` has no `<meta>`, so every ask walked the whole document to miss: 10 µs a `log.debug` in
// chromium beside a 1000-row list. THE REVERT: drop the memo in `environment`; the selector runs
// 100 times rather than at most 1.
test('a browser reads the document DEBUG at most once — 28.10', () => {
    const querySelector = document.querySelector.bind(document)
    let lookups = 0
    document.querySelector = ((selector: string) => {
        if (selector.includes(DEBUG_META)) lookups += 1
        return querySelector(selector)
    }) as typeof document.querySelector
    const server = Object.getOwnPropertyDescriptor(globalThis, 'process')
    // A browser is where there is no `process`.
    Object.defineProperty(globalThis, 'process', {
        value: undefined,
        configurable: true,
    })
    try {
        const rows = namedLogger('ledger:rows')
        for (let at = 0; at < 100; at += 1) rows.debug('row', at)
    } finally {
        Object.defineProperty(globalThis, 'process', server ?? {})
        document.querySelector = querySelector
    }
    expect(lookups).toBeLessThanOrEqual(1)
})

// 28.4 IN A BROWSER — `log.named` prefixes the app's name there too, read off the `<meta>` the server
// writes beside `DEBUG`: a logger was `dogfood:billing` on the server and `app:billing` in the browser,
// so one `DEBUG` could never open both. THE REVERT: drop the `APP_NAME` arm from `environment`; the
// browser's line is under `app:billing`.
test("a browser's log.named prefixes the app name the document carries — 28.4", () => {
    const meta = document.createElement('meta')
    meta.name = APP_META
    meta.content = 'ledger'
    document.head.append(meta)
    const server = Object.getOwnPropertyDescriptor(globalThis, 'process')
    Object.defineProperty(globalThis, 'process', {
        value: undefined,
        configurable: true,
    })
    try {
        log.named('billing').warning('sent')
    } finally {
        Object.defineProperty(globalThis, 'process', server ?? {})
        meta.remove()
    }
    expect(log.records().at(-1)?.namespace).toBe('ledger:billing')
})

// 44.31 — A CONVERSATION WRITES ONE LINE ON `abide:assistant` WHEN ITS EVENTS END, and one its caller
// stopped reading reads `unfinished`. THE REVERT: yield the provider's events untraced in `assistant`;
// neither conversation writes a line.
test('a conversation writes one debug line on abide:assistant when it ends — 44.31', async () => {
    process.env.DEBUG = 'abide:assistant'
    const played: AssistantEvent[] = [
        { type: 'tool', id: 't1', name: 'get_contacts' },
        { type: 'input', id: 't1', input: {} },
        { type: 'result', id: 't1', text: '[]', failed: false },
        { type: 'done', stop: 'end_turn', usage: { input: 12, output: 3 } },
    ]
    const provider = {
        async *run() {
            yield* played
        },
    }
    const conversation = (): AsyncGenerator<AssistantEvent> =>
        assistant([{ role: 'user', content: 'who?' }], provider)
    const lines = (): string[] =>
        (log.records.peek() ?? [])
            .filter((record) => record.namespace === 'abide:assistant')
            .map((record) => record.message)
    const before = lines().length
    await inScope(new Request('http://crm.test/ask'), async () => {
        for await (const _ of conversation());
        for await (const _ of conversation()) break
    })
    const written = lines().slice(before)
    expect(written.length).toBe(2)
    expect(written[0]).toMatch(
        /^end_turn 1 messages 1 tool calls 12\/3 tokens \d+\.\dms$/,
    )
    expect(written[1]).toMatch(
        /^unfinished 1 messages 1 tool calls no usage \d+\.\dms$/,
    )
})
