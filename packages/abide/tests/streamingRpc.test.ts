import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { prepareRpcModule } from '../src/lib/shared/prepareRpcModule.ts'
import type { NamedAsyncIterable } from '../src/lib/shared/types/NamedAsyncIterable.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'

/* Type-driven streaming: a handler that calls jsonl()/sse() is detected at build time
   (prepareRpcModule.streaming), the client stub is emitted `{ streaming: true }`, and the bare
   call returns a NamedAsyncIterable directly (for await / state(fn(args))), no `.stream()`. */
describe('streaming detection (codegen)', () => {
    const mod = (body: string) =>
        `import { GET } from '@abide/abide/server/GET'\nimport { jsonl } from '@abide/abide/server/jsonl'\nexport const feed = ${body}`

    test('handler calling jsonl() → streaming', () => {
        expect(
            prepareRpcModule(mod('GET((a) => jsonl(source()))'), '@abide/abide')?.streaming,
        ).toBe(true)
    })

    test('plain handler → not streaming', () => {
        expect(
            prepareRpcModule(
                `import { GET } from '@abide/abide/server/GET'\nexport const feed = GET((a) => ({ ok: true }))`,
                '@abide/abide',
            )?.streaming,
        ).toBe(false)
    })

    test('jsonl mentioned only in a string literal does not misfire', () => {
        expect(
            prepareRpcModule(
                `import { GET } from '@abide/abide/server/GET'\nexport const feed = GET((a) => "see jsonl(x) in docs")`,
                '@abide/abide',
            )?.streaming,
        ).toBe(false)
    })

    test('server rewrite injects the streaming flag into opts, preserving author opts', () => {
        const server = prepareRpcModule(
            mod('GET((a) => jsonl(source()), { timeout: 5 })'),
            '@abide/abide',
        )?.rewriteForServer('/rpc/feed')
        expect(server).toContain('streaming: true')
        expect(server).toContain('timeout: 5')
    })

    test('server rewrite handles a trailing comma after opts — no empty `...()` spread', () => {
        /* Regression: a trailing comma made lastArgText read '' as opts → `...()` (syntax error). */
        const server = prepareRpcModule(
            mod('GET(({ to }) => jsonl(source()), { inputSchema },)'),
            '@abide/abide',
        )?.rewriteForServer('/rpc/feed')
        expect(server).toContain('streaming: true')
        expect(server).toContain('...({ inputSchema })')
        expect(server).not.toContain('...()')
    })

    test('non-streaming server rewrite carries no streaming flag', () => {
        const server = prepareRpcModule(
            `import { GET } from '@abide/abide/server/GET'\nexport const feed = GET((a) => ({ ok: true }))`,
            '@abide/abide',
        )?.rewriteForServer('/rpc/feed')
        expect(server).not.toContain('streaming: true')
    })
})

describe('streaming rpc — bare call returns a NamedAsyncIterable', () => {
    const realFetch = globalThis.fetch
    beforeEach(() => {
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
        globalThis.fetch = (async () =>
            new Response('{"n":1}\n{"n":2}\n', {
                headers: { 'content-type': 'application/jsonl' },
            })) as unknown as typeof fetch
    })
    afterEach(() => {
        globalThis.fetch = realFetch
        delete (globalThis as { window?: unknown }).window
    })

    test('the bare call is a NamedAsyncIterable; for await yields the frames', async () => {
        const feed = remoteProxy<undefined, AsyncIterable<{ n: number }>>('GET', '/rpc/feed', {
            streaming: true,
        })
        const sub = feed() as NamedAsyncIterable<{ n: number }>
        expect(typeof sub.name).toBe('string')
        expect(typeof sub[Symbol.asyncIterator]).toBe('function')

        const frames: Array<{ n: number }> = []
        for await (const frame of sub) {
            frames.push(frame)
        }
        expect(frames).toEqual([{ n: 1 }, { n: 2 }])
    })
})
