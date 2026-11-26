// 18.4, 18.14 — WHAT A `GET`'s VALUE DECLARES REACHES THE BROWSER'S COPY. The build reads it off the
// `reactive(…)` the handler is declared over and writes it into the wrapper the browser imports in
// place of the module (16.28), and the wrapper builds its copy by it; the answer's own `max-age` is
// how long the copy may serve what it was answered.

import { afterAll, expect, test } from 'bun:test'

import { flushSync, invalidate, reactive, watch } from '#shared'
import { reachOf } from '#shared/rpc.ts'
import { rowKeyOf } from '#ui/rowKeyOf.ts'
import { resetSocketWire } from '#ui/socketWire.ts'
import { wire } from '#ui/wire.ts'

import { appFixture, buildApp, builtCompilation } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// Reaching a copy starts its load and its follow: answered here, and a socket that never opens, for
// `wire.test.ts`'s reason. `answer` is what the next load is handed.
let answer: { body: unknown; life: string } = {
    body: [],
    life: 'private, no-store',
}
let loads = 0
const unstubbedSocket = globalThis.WebSocket
const unstubbedFetch = globalThis.fetch
globalThis.WebSocket = class {
    static OPEN = 1
    readyState = 0
    send(): void {}
    close(): void {}
} as unknown as typeof WebSocket
// A browser with no route to the server: `fetch` rejects, as it does offline.
let unreachable = false
globalThis.fetch = (async () => {
    loads += 1
    if (unreachable) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(answer.body), {
        headers: {
            'content-type': 'application/json',
            'cache-control': answer.life,
        },
    })
}) as unknown as typeof fetch
afterAll(() => {
    resetSocketWire()
    globalThis.WebSocket = unstubbedSocket
    globalThis.fetch = unstubbedFetch
    removeTemporaryModules()
})

const LIBRARY = `import { deepEqual, memo, reactive, rpc } from '@abide/abide/server'

const shelf = reactive([{ id: 'a' }], {
    global: true,
    key: 'id',
    tags: ['shelf', 'library'],
    identity: deepEqual,
})

export const bound = rpc(shelf)
export const inline = rpc(reactive.derived(() => [{ isbn: '1' }], { key: 'isbn' }))
export const keyedCopy = rpc(({ id }: { id: string }) => [{ id }], { key: (row) => row.id,
        tags: ({ id }) => [id],
        identity: (next, previous) => next === previous })
export const plain = rpc(() => [1])
export const optioned = rpc(() => [{ isbn: '1' }], {
    key: 'isbn',
    description: 'Books.',
})
export const change = rpc(() => undefined, { methods: ['POST'] })
`

// THE REVERTS: hand back `undefined` from `declaredCopy`; every wrapper is written without a record,
// and `bound`, `inline` and `optioned` lose theirs. Read the options off a `reactive(…)` alone and
// `optioned` loses its — the plain handler's are the `GET`'s own (16.6).
test('the build writes what a GET declares for its copy into the wrapper, and no more', async () => {
    const app = appFixture({
        'index.abide': '<main>home</main>',
        'library/lib/Handlers.abide': `<script server>
${LIBRARY}</script>
`,
    })
    const built = await buildApp(app)
    expect(built.exitCode).toBe(0)
    const wrapper =
        (await builtCompilation(app)).files['library/lib/Handlers.abide']
            ?.client ?? ''
    const line = (name: string): string =>
        wrapper.split('\n').find((each) => each.includes(`const ${name} =`)) ??
        ''
    expect(line('bound')).toContain(
        '{"key":"id","tags":["shelf","library"],"identity":"deepEqual"}',
    )
    expect(line('inline')).toContain('{"key":"isbn"}')
    expect(line('optioned')).toContain('{"key":"isbn"}')
    // Functions have no serialization, a plain handler declares nothing, and a mutation walks nothing.
    for (const name of ['keyedCopy', 'plain', 'change'])
        expect(line(name)).not.toContain('{"')
    // …and a function form is the server's by design, which is nothing to warn on (18.15).
    expect(built.stderr).not.toContain('18.15')
})

// 18.4 OFF THE TYPE, 18.15 FOR THE REST. THE REVERT: read `key` and `tags` off literal syntax alone;
// `named` and `handed` are written without a record, and nothing warns on `grown`.
test('an option bound to a const carries its literal, and one the build cannot read is warned on', async () => {
    const app = appFixture({
        'index.abide': '<main>home</main>',
        'named/lib/Handlers.abide': `<script server>
import { reactive, rpc } from '@abide/abide/server'

const KEY = 'isbn'
const TAGS = ['shelf', 'named'] as const
const OPTIONS = { key: KEY, tags: TAGS }
let grown = 'is'
grown += 'bn'

export const named = rpc(
    reactive.derived(() => [{ isbn: '1' }], { key: KEY, tags: TAGS }),
)
export const handed = rpc(reactive.derived(() => [{ isbn: '1' }], OPTIONS))
export const unread = rpc(reactive.derived(() => [{ isbn: '1' }], { key: grown }))
</script>
`,
    })
    const built = await buildApp(app)
    expect(built.exitCode).toBe(0)
    const wrapper =
        (await builtCompilation(app)).files['named/lib/Handlers.abide']
            ?.client ?? ''
    const line = (name: string): string =>
        wrapper.split('\n').find((each) => each.includes(`const ${name} =`)) ??
        ''
    for (const name of ['named', 'handed'])
        expect(line(name)).toContain('{"key":"isbn","tags":["shelf","named"]}')
    expect(line('unread')).not.toContain('{"')
    expect(built.stderr).toContain('`key: grown`')
    expect(built.stderr).toContain('RULEBOOK 18.15')
})

// 32.32 — THE KEY. THE REVERT: build the copy without its record in `wire`; the list over it is
// positional, and the key it hands back for a row is its index.
test('a copy the wrapper keys is what a {#for} over it keys by', () => {
    const books = wire('GET', '/library/keyed', {
        key: 'id',
    })
    const key = rowKeyOf(reachOf(books), (_item, at) => at)
    expect(key({ id: 'dune' }, 3)).toBe('dune')
})

// 11.43 — THE TAGS. A selection by tag reaches the copy, so the next read loads again. THE REVERT: drop
// `tags` from `copyOptions`; the selection matches nothing and 0 loads are made where 1 is due.
test('a selection by the tags a GET declares reaches its copy', async () => {
    answer = { body: ['dune'], life: 'private, no-store' }
    const tagged = wire('GET', '/library/tagged', {
        tags: ['shelf'],
    }) as (args?: unknown) => (() => unknown) & PromiseLike<unknown>
    await tagged()
    const before = loads
    invalidate({ tags: ['shelf'] })
    await tagged()
    expect(loads - before).toBe(1)
})

// 5.3, 5.4 — THE COMPARATOR. A load answering the same shelf as fresh JSON is the same value under
// `deepEqual`, and wakes nobody. THE REVERT: drop `identity` from `copyOptions`; the reference
// compare calls every parse new, and the reader is woken 1 time where 0 are due.
test('a copy compared structurally wakes nobody for a load that answers the same', async () => {
    answer = { body: [{ id: 'dune' }], life: 'private, no-store' }
    const shelfRpc = wire('GET', '/library/compared', {
        identity: 'deepEqual',
    })
    const shelf = () =>
        reachOf(shelfRpc) as (() => unknown) & {
            refresh(): void
        } & PromiseLike<unknown>
    await shelf()
    let woken = 0
    const stop = watch(() => {
        shelf()()
        woken += 1
    })
    flushSync()
    const before = woken
    shelf().refresh()
    await Bun.sleep(10)
    flushSync()
    expect(woken - before).toBe(0)
    stop()
})

// 18.14 — THE LIFE. An answer carrying `max-age=1` is served for a second and then goes stale, so the
// read after it loads again. THE REVERT: skip `expireAfter` in `followRpc`; the copy is served for
// good and 0 loads are made where 1 is due.
test('a copy goes stale when the max-age its answer carried runs out', async () => {
    answer = { body: ['fresh'], life: 'private, max-age=1' }
    const timed = wire('GET', '/library/timed') as (
        args?: unknown,
    ) => (() => unknown) & PromiseLike<unknown>
    await timed()
    const before = loads
    await timed()
    expect(loads - before).toBe(0)
    await Bun.sleep(1_200)
    await timed()
    expect(loads - before).toBe(1)
})

// A LIFE THE SERVER ROUNDED DOWN TO NOTHING. What is left under a second answers `max-age=0`, and the
// copy is stale as soon as it lands. THE REVERT: start the timer only for `seconds > 0`; the copy is
// served for good and 0 loads are made where 1 is due.
test('a copy answered max-age=0 is stale at once', async () => {
    answer = { body: ['last'], life: 'private, max-age=0' }
    const ending = wire('GET', '/library/ending') as (
        args?: unknown,
    ) => (() => unknown) & PromiseLike<unknown>
    await ending()
    const before = loads
    await Bun.sleep(10)
    await ending()
    expect(loads - before).toBe(1)
})

// 11.29 — THE DEFAULTS A HANDLER'S PARAMETER WRITES REACH ITS COPY, read by the reader the server keys
// by, so a mutation's too; a handler with none writes none, and one the key cannot read stops the
// build rather than the server's import. THE REVERT: leave `defaults` out of `wireLine`; no
// wrapper line carries `"names"`.
test("the build writes a handler's parameter defaults into its wrapper, and refuses one it cannot read", async () => {
    const app = appFixture({
        'index.abide': '<main>home</main>',
        'paged/lib/Handlers.abide': `<script server>
import { memo, rpc } from '@abide/abide/server'

export const list = rpc(async ({ page = 1, q = 'all' }: { page?: number; q?: string }) => [page, q])
export const kept = rpc(({ size = 20 }: { size?: number }) => size, { key: 'id' })
export const save = rpc(async ({ draft = true }: { draft?: boolean }) => draft, { methods: ['POST'] })
export const plain = rpc(async ({ id }: { id: string }) => id)
</script>
`,
    })
    const built = await buildApp(app)
    expect(built.exitCode).toBe(0)
    const wrapper =
        (await builtCompilation(app)).files['paged/lib/Handlers.abide']
            ?.client ?? ''
    const line = (name: string): string =>
        wrapper.split('\n').find((each) => each.includes(`const ${name} =`)) ??
        ''
    expect(line('list')).toContain(
        'undefined, {"names":["page","q"],"values":[1,"all"]})',
    )
    expect(line('kept')).toContain(
        '{"key":"id"}, {"names":["size"],"values":[20]})',
    )
    expect(line('save')).toContain('{"names":["draft"],"values":[true]}')
    expect(line('plain')).not.toContain('"names"')

    const refused = appFixture({
        'index.abide': '<main>home</main>',
        'paged/lib/Handlers.abide': `<script server>
import { rpc } from '@abide/abide/server'

const PAGE_SIZE = 20
export const list = rpc(async ({ size = PAGE_SIZE }: { size?: number }) => size)
</script>
`,
    })
    const stopped = await buildApp(refused)
    expect(stopped.exitCode).not.toBe(0)
    expect(stopped.stderr).toContain('defaults `size` to `PAGE_SIZE`')
    expect(stopped.stderr).toContain('RULEBOOK 11.29')
})

// 11.29 IN THE BROWSER — the copy keys by the defaults the build handed it, as the server does, so a
// call leaving a member to one and a call writing it are one load. THE REVERT: skip
// `declareDefaults` in `wire`; 2 loads are made where 1 is due.
test("a copy keys a call leaving a member to the handler's default with one that wrote it", async () => {
    answer = { body: ['one'], life: 'private, no-store' }
    const paged = wire('GET', '/paged/list', undefined, {
        names: ['page'],
        values: [1],
    }) as (args?: unknown) => (() => unknown) & PromiseLike<unknown>
    const before = loads
    await paged({})
    await paged({ page: 1 })
    expect(`loads: ${loads - before}`).toBe('loads: 1')
})

// 30.3, 30.19, 15.8 — A PATH PARAMETER NO ADDRESS CAN CARRY IS REFUSED AS ITS ARGS, 422, and nothing
// is fetched: the call has no address to be made at. THE REVERT: throw a plain `Error` from
// `rpcRequest`'s path; the copy holds that `Error`, not a `ValidationError`.
test('a call whose path parameter has no spelling is a ValidationError, and fetches nothing', async () => {
    const thread = wire('GET', '/comments/[id]/list')
    const before = loads
    for (const id of ['', '..', undefined]) {
        const refused = reachOf(thread, { id }) as {
            error(): unknown
        } & PromiseLike<unknown>
        await Promise.resolve(refused).catch(() => {})
        const error = refused.error() as { name?: string; status?: number }
        expect(`${id}: ${error?.name} ${error?.status}`).toBe(
            `${id}: ValidationError 422`,
        )
    }
    expect(loads - before).toBe(0)
})

type Copy = (args?: unknown) => Promise<unknown>

const outcome = (copy: PromiseLike<unknown>): Promise<string> =>
    Promise.resolve(copy).then(
        (value) => `served ${JSON.stringify(value)}`,
        (error: { name?: string; status?: number }) =>
            `threw ${error.name} ${error.status}`,
    )

// 16.79 — NO ANSWER IS A 503, not the browser's `TypeError`. THE REVERT: drop the `catch` around the
// `fetch` in `answerOf`'s `fetched`; this reads `threw TypeError undefined`.
test('a call that reaches no server refuses with HttpError at 503 — 16.79', async () => {
    unreachable = true
    try {
        const nowhere = wire('GET', '/library/nowhere') as Copy
        expect(await outcome(nowhere())).toBe('threw HttpError 503')
    } finally {
        unreachable = false
    }
})

// 7.19 — STALE AND UNREACHABLE, THE COPY GOES ON SERVING what it held, with the 503 on `s.error`. THE
// REVERT: drop the `serveAgain` arm from `refused`; the read throws and this reads
// `threw HttpError 503`.
test('a stale copy whose reload reaches no server goes on serving what it held — 7.19', async () => {
    answer = { body: ['kept'], life: 'private, max-age=0' }
    const offline = wire('GET', '/library/offline') as Copy
    expect(await outcome(offline())).toBe('served ["kept"]')
    await Bun.sleep(10)
    unreachable = true
    try {
        const before = loads
        expect(await outcome(offline())).toBe('served ["kept"]')
        expect(loads - before).toBe(1)
        const error = (reachOf(offline) as { error(): unknown }).error() as
            { status?: number } | undefined
        expect(`error: ${error?.status}`).toBe('error: 503')
    } finally {
        unreachable = false
    }
})

// 16.110, 18.4 — A HANDLER'S PACE REACHES ITS COPY: the build writes a `throttle` or `debounce` a `GET`
// declares — on itself or on the `memo` it serves — and warns on one it cannot read (18.15). THE
// REVERT: drop the `throttle`/`debounce` arm from `declaredCopy`; no wrapper line carries `"debounce"`
// or `"throttle"`, and nothing warns on `grown`.
test("the build writes a GET's throttle or debounce into its wrapper — 16.110, 18.4, 18.15", async () => {
    const app = appFixture({
        'index.abide': '<main>home</main>',
        'paced/lib/Handlers.abide': `<script server>
import { memo, rpc } from '@abide/abide/server'

const WINDOW = 250
let grown = 100
grown += 1

export const searched = rpc(({ q }: { q: string }) => [q], { debounce: 300 })
export const served = rpc(memo(({ q }: { q: string }) => [q], { throttle: WINDOW }))
export const unread = rpc(({ q }: { q: string }) => [q], { debounce: grown })
</script>
`,
    })
    const built = await buildApp(app)
    expect(built.exitCode).toBe(0)
    const wrapper =
        (await builtCompilation(app)).files['paced/lib/Handlers.abide']
            ?.client ?? ''
    const line = (name: string): string =>
        wrapper.split('\n').find((each) => each.includes(`const ${name} =`)) ??
        ''
    expect(line('searched')).toContain('{"debounce":300}')
    expect(line('served')).toContain('{"throttle":250}')
    expect(line('unread')).not.toContain('{"')
    expect(built.stderr).toContain('`debounce: grown`')
})

// 16.110, 5.18 — THE COPY KEEPS THE PACE: the page's first key starts at once, and three typed inside
// the window after it send one request, for the last, once the typing stops. THE REVERT: drop
// `throttle`/`debounce` from what `copyOptions` hands `keyedValue`; this reads `requests: 3`.
test('a copy given a debounce sends one request for the keys a page reaches inside the window — 16.110, 5.18', async () => {
    answer = { body: ['found'], life: 'private, no-store' }
    const searched = wire('GET', '/library/searched', {
        debounce: 40,
    }) as (args: { q: string }) => (() => unknown) & PromiseLike<unknown>
    const q = reactive('')
    const found = reactive.derived(() => searched({ q: q() }))
    const stop = watch(() => {
        try {
            found()
        } catch {}
    })
    flushSync()
    const before = loads
    for (const typed of ['h', 'ho', 'hop']) {
        q.set(typed)
        flushSync()
        await Bun.sleep(5)
    }
    await Bun.sleep(120)
    flushSync()
    expect(`requests: ${loads - before}`).toBe('requests: 1')
    stop()
})
