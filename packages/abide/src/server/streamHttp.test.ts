// Streaming reads served over HTTP — build step 4a (replayable-streams.md §4).
//
// A read handler that yields a bare AsyncIterable is wrapped in a ReplayableStream; the ROUTER applies
// the transport encoding (jsonl / sse) downstream, once per HTTP consumer. This is the transport the
// client-attach handoff (step 4b) resumes over.

import { describe, expect, test } from 'bun:test'
import { createTestApp } from '../test/createTestApp.ts'
import { GET } from './GET.ts'
import { json } from './json.ts'
import { jsonl } from './jsonl.ts'
import { sse } from './sse.ts'

const argsQuery = (value: unknown) => `?args=${encodeURIComponent(JSON.stringify(value))}`
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('streaming read HTTP transport', () => {
    test('a bare async-generator read is served as application/jsonl (decoded chunks, one per line)', async () => {
        const app = createTestApp({
            routes: {
                ticker: GET(async function* (_args: Record<string, never>) {
                    yield 1
                    yield 2
                    yield 3
                }),
            },
        })
        const res = await app.fetch(`/rpc/ticker${argsQuery({})}`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('jsonl')
        const body = await res.text()
        expect(body.trim().split('\n')).toEqual(['1', '2', '3'])
        await app.stop()
    })

    test('Accept: text/event-stream selects SSE', async () => {
        const app = createTestApp({
            routes: {
                toks: GET(async function* (_args: Record<string, never>) {
                    yield 'a'
                    yield 'b'
                }),
            },
        })
        const res = await app.fetch(`/rpc/toks${argsQuery({})}`, {
            headers: { accept: 'text/event-stream' },
        })
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('text/event-stream')
        await res.text()
        await app.stop()
    })

    test('a shared streaming read served concurrently over HTTP runs the source ONCE', async () => {
        let runs = 0
        const app = createTestApp({
            routes: {
                gen: GET(
                    async function* (_args: Record<string, never>) {
                        runs++
                        for (let i = 0; i < 3; i++) {
                            await new Promise((r) => setTimeout(r, 3))
                            yield i
                        }
                    },
                    { cache: { shared: true, ttl: 10_000 } },
                ),
            },
        })

        const [a, b] = await Promise.all([
            app.fetch(`/rpc/gen${argsQuery({})}`),
            app.fetch(`/rpc/gen${argsQuery({})}`),
        ])
        const [ba, bb] = await Promise.all([a.text(), b.text()])
        expect(ba.trim().split('\n')).toEqual(['0', '1', '2'])
        expect(bb.trim().split('\n')).toEqual(['0', '1', '2'])
        expect(runs).toBe(1) // both HTTP consumers fanned out over one ReplayableStream run
        await app.stop()
    })
})

describe('resumable stream replay (?from=count)', () => {
    test('?from=N resumes a RETAINED transcript from chunk N (replay then end)', async () => {
        const app = createTestApp({
            routes: {
                gen: GET(
                    async function* (_a: Record<string, never>) {
                        for (let i = 0; i < 5; i++) yield i
                    },
                    { cache: { shared: true, ttl: 10_000 } },
                ),
            },
        })

        const first = await app.fetch(`/rpc/gen${argsQuery({})}`)
        expect((await first.text()).trim().split('\n')).toEqual(['0', '1', '2', '3', '4'])

        const resume = await app.fetch(`/rpc/gen${argsQuery({})}&from=2`)
        expect(resume.headers.get('x-abide-stream-resume')).toBe('live')
        expect((await resume.text()).trim().split('\n')).toEqual(['2', '3', '4'])
        await app.stop()
    })

    test("?from=N with no retained transcript runs fresh from 0 and flags 'fresh' (client replaces)", async () => {
        let runs = 0
        const app = createTestApp({
            routes: {
                g2: GET(
                    async function* (_a: Record<string, never>) {
                        runs++
                        yield 1
                        yield 2
                    },
                    { cache: { shared: true, ttl: 10_000 } },
                ),
            },
        })

        // Cold slot: resuming from 5 has nothing to replay → a fresh run from 0.
        const res = await app.fetch(`/rpc/g2${argsQuery({})}&from=5`)
        expect(res.headers.get('x-abide-stream-resume')).toBe('fresh')
        expect((await res.text()).trim().split('\n')).toEqual(['1', '2'])
        expect(runs).toBe(1)
        await app.stop()
    })
})

describe('transport helpers behave like their raw forms (see-through)', () => {
    test('json(x) is served as JSON and resolves to the value (like returning x raw)', async () => {
        const app = createTestApp({
            routes: { info: GET((_a: Record<string, never>) => json({ n: 7 })) },
        })
        const res = await app.fetch(`/rpc/info${argsQuery({})}`)
        expect(res.headers.get('content-type')).toContain('application/json')
        expect(await res.json()).toEqual({ n: 7 })
        await app.stop()
    })

    test('jsonl(gen()) is replayable + coalesced like an async generator', async () => {
        let runs = 0
        const app = createTestApp({
            routes: {
                ev: GET(
                    (_a: Record<string, never>) => {
                        runs++
                        return jsonl(
                            (async function* () {
                                await sleep(3)
                                yield 1
                                yield 2
                            })(),
                        )
                    },
                    { cache: { shared: true, ttl: 10_000 } },
                ),
            },
        })
        const [a, b] = await Promise.all([
            app.fetch(`/rpc/ev${argsQuery({})}`),
            app.fetch(`/rpc/ev${argsQuery({})}`),
        ])
        expect((await a.text()).trim().split('\n')).toEqual(['1', '2'])
        expect((await b.text()).trim().split('\n')).toEqual(['1', '2'])
        expect(runs).toBe(1) // saw through jsonl() to the generator → one run, fanned out
        await app.stop()
    })

    test("sse(gen()) keeps the handler's SSE encoding after see-through", async () => {
        const app = createTestApp({
            routes: {
                s: GET((_a: Record<string, never>) =>
                    sse(
                        (async function* () {
                            yield 'a'
                        })(),
                    ),
                ),
            },
        })
        const res = await app.fetch(`/rpc/s${argsQuery({})}`)
        expect(res.headers.get('content-type')).toContain('text/event-stream')
        await res.text()
        await app.stop()
    })
})
