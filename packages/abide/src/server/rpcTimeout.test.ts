// The rpc RUN DEADLINE (ADR 0028). These tests exist because the option they cover was DECLARED and
// never enforced while a green suite reported otherwise — and three SSR modules had already been
// written against it as an invariant. So the assertions are chosen to fail on the plausible wrong
// implementations, not merely to exercise the happy path:
//
//   • a total-wall-clock deadline passes every test here except `progress semantics`;
//   • a caller-side race that leaves the handler running passes every in-proc test, so the HTTP tests
//     assert THE HANDLER'S OWN SIGNAL fired — the work the feature exists to stop;
//   • disposing the slot instead of expiring it passes "the next read re-runs" but blanks `fn.error()`,
//     so both halves are asserted in one test.
//
// No test uses the 5-minute default: every one declares its own `timeout`.

import { describe, expect, test } from 'bun:test'
import { createTestApp } from '../test/createTestApp.ts'
import { GET } from './GET.ts'
import { anonymousPrincipal, type RequestScope, runInScope } from './internal/requestScope.ts'
import { jsonl } from './jsonl.ts'
import { POST } from './POST.ts'
import { request } from './request.ts'

function makeScope(overrides?: Partial<RequestScope>): RequestScope {
    const url = new URL('http://localhost/test')
    return {
        request: new Request(url),
        cookies: new Bun.CookieMap(),
        identity: anonymousPrincipal(),
        bag: {},
        route: { kind: 'rpc', name: 'test', params: {}, url, navigating: false },
        slots: new Map<string, unknown>(),
        ...overrides,
    }
}

const TIMEOUT_MS = 50

// Settle a promise expected to REJECT and hand back the error. Deliberately not
// `expect(p).rejects.toMatchObject({ name })`: the deadline rejects with a real `DOMException`, whose
// `name` lives on the PROTOTYPE — `toMatchObject` compares own properties and would never see it.
async function rejection(promise: Promise<unknown>): Promise<{ name?: string }> {
    try {
        await promise
    } catch (error) {
        return error as { name?: string }
    }
    throw new Error('expected the call to reject, but it resolved')
}

// Drain an async iterable, returning what arrived AND whatever ended it — a stream deadline is only
// meaningful against the prefix it delivered.
async function drain(
    source: AsyncIterable<unknown>,
): Promise<{ seen: unknown[]; error?: { name?: string } }> {
    const seen: unknown[] = []
    try {
        for await (const chunk of source) seen.push(chunk)
    } catch (error) {
        return { seen, error: error as { name?: string } }
    }
    return { seen }
}

const never = (): Promise<never> => new Promise<never>(() => {})

describe('run deadline — per shape', () => {
    test('a value READ rejects with TimeoutError', async () => {
        const get = GET(async () => await never(), { timeout: TIMEOUT_MS })

        await runInScope(makeScope(), async () => {
            expect((await rejection(get())).name).toBe('TimeoutError')
        })
    })

    test('a value MUTATION rejects with TimeoutError', async () => {
        const post = POST(async () => await never(), { timeout: TIMEOUT_MS })

        await runInScope(makeScope(), async () => {
            expect((await rejection(post({}))).name).toBe('TimeoutError')
        })
    })

    test('a `memo: false` mutation is bounded too — opting out of the memo is not opting out of the deadline', async () => {
        const post = POST(async () => await never(), { timeout: TIMEOUT_MS, memo: false })

        await runInScope(makeScope(), async () => {
            expect((await rejection(post({}))).name).toBe('TimeoutError')
        })
    })

    test('a STREAMING read whose source stalls fails the transcript, keeping the prefix', async () => {
        const get = GET(
            () =>
                jsonl(
                    (async function* () {
                        yield 1
                        await never() // stall forever after one chunk
                    })(),
                ),
            { timeout: TIMEOUT_MS },
        )

        await runInScope(makeScope(), async () => {
            const drained = await drain((await get()) as AsyncIterable<unknown>)
            // The chunks that DID arrive are still delivered — the transcript is failed, not discarded.
            expect(drained.seen).toEqual([1])
            // `fail`, not `abort`: an aborted ReplayableStream ends its consumers SILENTLY, and a
            // truncated list a caller cannot tell from a finished one is the failure mode D8 rejects.
            expect(drained.error?.name).toBe('TimeoutError')
        })
    })

    test('a STREAMING mutation is bounded on the same clock', async () => {
        const post = POST(
            () =>
                jsonl(
                    (async function* () {
                        yield 'a'
                        await never()
                    })(),
                ),
            { timeout: TIMEOUT_MS },
        )

        await runInScope(makeScope(), async () => {
            const drained = await drain((await post({})) as AsyncIterable<unknown>)
            expect(drained.seen).toEqual(['a'])
            expect(drained.error?.name).toBe('TimeoutError')
        })
    })
})

describe('run deadline — progress semantics', () => {
    // THE test that separates ADR 0028 D1 from a total-duration bound. A total-wall-clock
    // implementation passes every other test in this file and fails only here.
    test('a stream yielding faster than the timeout runs well past it', async () => {
        const get = GET(
            () =>
                jsonl(
                    (async function* () {
                        for (let i = 0; i < 12; i++) {
                            await Bun.sleep(20)
                            yield i
                        }
                    })(),
                ),
            { timeout: TIMEOUT_MS },
        )

        await runInScope(makeScope(), async () => {
            const drained = await drain((await get()) as AsyncIterable<unknown>)
            // 12 chunks x 20ms ≈ 240ms of wall clock against a 50ms deadline. Every inter-chunk GAP is
            // under it, so a progress clock never trips and the whole transcript arrives.
            expect(drained.error).toBeUndefined()
            expect(drained.seen).toHaveLength(12)
        })
    })

    test('the same stream trips once it goes idle longer than the timeout', async () => {
        const get = GET(
            () =>
                jsonl(
                    (async function* () {
                        yield 'fast'
                        await Bun.sleep(20)
                        yield 'still fast'
                        await never() // now idle past the deadline
                    })(),
                ),
            { timeout: TIMEOUT_MS },
        )

        await runInScope(makeScope(), async () => {
            const drained = await drain((await get()) as AsyncIterable<unknown>)
            expect(drained.seen).toEqual(['fast', 'still fast'])
            expect(drained.error?.name).toBe('TimeoutError')
        })
    })
})

describe('run deadline — retention', () => {
    // ADR 0028 D7, both halves in one test. Either alone passes on the wrong implementation: disposing
    // the slot makes the re-run assertion pass while blanking the probe, and retaining normally makes
    // the probe assertion pass while caching the TimeoutError for the rest of a read's infinite ttl.
    test('a timed-out slot still reports its error AND the next read runs cold', async () => {
        let calls = 0
        const get = GET(
            async () => {
                calls++
                if (calls === 1) return await never()
                return 'recovered'
            },
            { timeout: TIMEOUT_MS },
        )

        await runInScope(makeScope(), async () => {
            expect((await rejection(get())).name).toBe('TimeoutError')

            // The probe still sees it — an error banner must not flash and vanish.
            expect((get.error() as { name?: string })?.name).toBe('TimeoutError')

            // ...and the slot is expired, so the retry is a fresh run, not the cached rejection.
            expect(await get()).toBe('recovered')
            expect(calls).toBe(2)
        })
    })

    test('a NON-timeout error keeps today’s retention — only deadlines expire on arrival', async () => {
        let calls = 0
        const get = GET(
            async () => {
                calls++
                throw new Error('nope')
            },
            { timeout: TIMEOUT_MS },
        )

        await runInScope(makeScope(), async () => {
            expect((await rejection(get())).name).toBe('Error')
            expect((await rejection(get())).name).toBe('Error')
            // A 404 or a validation failure is not worth retrying; only the deadline is.
            expect(calls).toBe(1)
        })
    })
})

describe('run deadline — a caller’s signal', () => {
    // D3: the author owns the work, the caller owns their wait. A caller walking away must not take the
    // run — nor the cache fill every other caller is coalesced onto — with them.
    test('an aborted caller rejects while the run completes and fills the slot', async () => {
        let settle: ((value: string) => void) | undefined
        let calls = 0
        const get = GET(
            () => {
                calls++
                return new Promise<string>((resolve) => {
                    settle = resolve
                })
            },
            { timeout: 0 },
        )

        await runInScope(makeScope(), async () => {
            const controller = new AbortController()
            const abandoned = get(undefined, { signal: controller.signal })
            const caught = rejection(abandoned)
            controller.abort(new DOMException('caller left', 'AbortError'))
            expect((await caught).name).toBe('AbortError')

            // The run was never cancelled: it settles, fills the slot, and the next read is a cache hit
            // rather than a second invocation.
            settle?.('landed')
            expect(await get()).toBe('landed')
            expect(calls).toBe(1)
        })
    })

    test('a caller can impose a tighter bound with AbortSignal.timeout — no per-call timeout option needed', async () => {
        const get = GET(async () => await never(), { timeout: 0 })

        await runInScope(makeScope(), async () => {
            const caught = await rejection(get(undefined, { signal: AbortSignal.timeout(20) }))
            expect(caught.name).toBe('TimeoutError')
        })
    })
})

describe('run deadline — over HTTP, the handler is told to stop', () => {
    // The assertion that a caller-side race cannot fake (D5). `request().signal` is the substituted,
    // composed one, so a handler threading it into its own I/O really does get torn down — which is what
    // "the server aborts its work" means, as opposed to "the caller stopped waiting".
    test('the handler’s request().signal aborts at the deadline', async () => {
        let observed: AbortSignal | undefined
        const slow = GET(
            async () => {
                observed = request().signal
                await never()
                return 'unreachable'
            },
            { timeout: TIMEOUT_MS },
        )

        const app = await createTestApp({ routes: { slow } })
        try {
            const response = await app.fetch('/__abide/rpc/slow')
            expect(response.status).toBe(504)
            const body = (await response.json()) as { name?: string }
            expect(body.name).toBe('TimeoutError')
            expect(observed?.aborted).toBe(true)
        } finally {
            await app.stop()
        }
    })

    test('a timed-out read answers 504 with a TimeoutError a caller can narrow', async () => {
        const slow = GET(async () => await never(), { timeout: TIMEOUT_MS })

        const app = await createTestApp({ routes: { slow } })
        try {
            const response = await app.fetch('/__abide/rpc/slow')
            expect(response.status).toBe(504)
            // `fn.isError(e, 'TimeoutError')` narrows on `kind`/`name`, so the wire body must carry the
            // name — otherwise the two sides of an isomorphic call disagree about what happened.
            expect(((await response.json()) as { name?: string }).name).toBe('TimeoutError')
        } finally {
            await app.stop()
        }
    })
})
