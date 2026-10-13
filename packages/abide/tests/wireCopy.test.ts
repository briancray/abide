// 18.4, 18.14 — WHAT A `GET`'s VALUE DECLARES REACHES THE BROWSER'S COPY. The build reads it off the
// `reactive(…)` the handler is declared over and writes it into the wrapper the browser imports in
// place of the module (16.28), and the wrapper builds its copy by it; the answer's own `max-age` is
// how long the copy may serve what it was answered.

import { afterAll, expect, test } from 'bun:test'
import { flushSync, invalidate, watch } from '#shared'
import { rowKeyOf } from '#ui/rowKeyOf.ts'
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
let asked: RequestInit | undefined
const unstubbedSocket = globalThis.WebSocket
const unstubbedFetch = globalThis.fetch
globalThis.WebSocket = class {
    static OPEN = 1
    readyState = 0
    send(): void {}
} as unknown as typeof WebSocket
globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    loads += 1
    asked = init
    return new Response(JSON.stringify(answer.body), {
        headers: {
            'content-type': 'application/json',
            'cache-control': answer.life,
        },
    })
}) as unknown as typeof fetch
afterAll(() => {
    globalThis.WebSocket = unstubbedSocket
    globalThis.fetch = unstubbedFetch
    removeTemporaryModules()
})

const settle = (ms = 10): Promise<void> =>
    new Promise((done) => setTimeout(done, ms))

const LIBRARY = `import { GET, POST, reactive, structural } from '@abide/abide/server'

const shelf = reactive([{ id: 'a' }], {
    global: true,
    by: 'id',
    tags: ['shelf', 'library'],
    identity: structural,
})

const bound = GET(shelf)
const inline = GET(reactive(() => [{ isbn: '1' }], { by: 'isbn' }))
const computed = GET(
    reactive(({ id }: { id: string }) => [{ id }], {
        by: (row) => row.id,
        tags: ({ id }) => [id],
        identity: (next, previous) => next === previous,
    }),
)
const plain = GET(() => [1])
const optioned = GET(() => [{ isbn: '1' }], {
    by: 'isbn',
    description: 'Books.',
})
const change = POST(() => undefined)
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
        '{"by":"id","tags":["shelf","library"],"identity":"structural"}',
    )
    expect(line('inline')).toContain('{"by":"isbn"}')
    expect(line('optioned')).toContain('{"by":"isbn"}')
    // Functions have no serialization, a plain handler declares nothing, and a mutation walks nothing.
    for (const name of ['computed', 'plain', 'change'])
        expect(line(name)).not.toContain('{"')
    // …and a function form is the server's by design, which is nothing to warn on (18.15).
    expect(built.stderr).not.toContain('18.15')
})

// 18.4 OFF THE TYPE, 18.15 FOR THE REST. THE REVERT: read `by` and `tags` off literal syntax alone;
// `named` and `handed` are written without a record, and nothing warns on `grown`.
test('an option bound to a const carries its literal, and one the build cannot read is warned on', async () => {
    const app = appFixture({
        'index.abide': '<main>home</main>',
        'named/lib/Handlers.abide': `<script server>
import { GET, reactive } from '@abide/abide/server'

const KEY = 'isbn'
const TAGS = ['shelf', 'named'] as const
const OPTIONS = { by: KEY, tags: TAGS }
let grown = 'is'
grown += 'bn'

const named = GET(
    reactive(() => [{ isbn: '1' }], { by: KEY, tags: TAGS }),
)
const handed = GET(reactive(() => [{ isbn: '1' }], OPTIONS))
const unread = GET(reactive(() => [{ isbn: '1' }], { by: grown }))
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
        expect(line(name)).toContain('{"by":"isbn","tags":["shelf","named"]}')
    expect(line('unread')).not.toContain('{"')
    expect(built.stderr).toContain('`by: grown`')
    expect(built.stderr).toContain('RULEBOOK 18.15')
})

// 32.32 — THE KEY. THE REVERT: build the copy without its record in `wire`; the list over it is
// positional, and the key it hands back for a row is its index.
test('a copy the wrapper keys is what a {#for} over it keys by', () => {
    const books = wire('GET', '/library/keyed', {
        by: 'id',
    }) as (args?: unknown) => unknown
    const key = rowKeyOf(books(), (_item, at) => at)
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
// `structural`, and wakes nobody. THE REVERT: drop `identity` from `copyOptions`; the reference
// compare calls every parse new, and the reader is woken 1 time where 0 are due.
test('a copy compared structurally wakes nobody for a load that answers the same', async () => {
    answer = { body: [{ id: 'dune' }], life: 'private, no-store' }
    const shelf = wire('GET', '/library/compared', {
        identity: 'structural',
    }) as (args?: unknown) => (() => unknown) & {
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
    await settle()
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
    await settle(1_200)
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
    await settle()
    await ending()
    expect(loads - before).toBe(1)
})

// THE BROWSER'S HTTP CACHE HEARS NO `invalidate`, and would answer a stale copy's reload with the
// value it was dropping. THE REVERT: leave `cache` out of `rpcRequest`'s init; this reads `undefined`.
test('a copy asks past the HTTP cache', async () => {
    answer = { body: ['fresh'], life: 'private, max-age=60' }
    const cached = wire('GET', '/library/cached') as (
        args?: unknown,
    ) => (() => unknown) & PromiseLike<unknown>
    await cached()
    expect(asked?.cache).toBe('no-cache')
})

// 11.29 — THE DEFAULTS A HANDLER'S PARAMETER WRITES REACH ITS COPY, read by the reader the server keys
// by, so a mutation's too; a handler with none writes none, and one the key cannot read stops the
// build rather than the server's import. THE REVERT: leave `defaults` out of `wireLine`; no
// wrapper line carries `"names"`.
test("the build writes a handler's parameter defaults into its wrapper, and refuses one it cannot read", async () => {
    const app = appFixture({
        'index.abide': '<main>home</main>',
        'paged/lib/Handlers.abide': `<script server>
import { GET, POST, reactive } from '@abide/abide/server'

const list = GET(async ({ page = 1, q = 'all' }: { page?: number; q?: string }) => [page, q])
const kept = GET(reactive(({ size = 20 }: { size?: number }) => size, { by: 'id' }))
const save = POST(async ({ draft = true }: { draft?: boolean }) => draft)
const plain = GET(async ({ id }: { id: string }) => id)
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
        '{"by":"id"}, {"names":["size"],"values":[20]})',
    )
    expect(line('save')).toContain('{"names":["draft"],"values":[true]}')
    expect(line('plain')).not.toContain('"names"')

    const refused = appFixture({
        'index.abide': '<main>home</main>',
        'paged/lib/Handlers.abide': `<script server>
import { GET } from '@abide/abide/server'

const PAGE_SIZE = 20
const list = GET(async ({ size = PAGE_SIZE }: { size?: number }) => size)
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
    const thread = wire('GET', '/comments/[id]/list') as (args?: unknown) => {
        error(): unknown
    } & PromiseLike<unknown>
    const before = loads
    for (const id of ['', '..', undefined]) {
        const refused = thread({ id })
        await Promise.resolve(refused).catch(() => {})
        const error = refused.error() as { name?: string; status?: number }
        expect(`${id}: ${error?.name} ${error?.status}`).toBe(
            `${id}: ValidationError 422`,
        )
    }
    expect(loads - before).toBe(0)
})
