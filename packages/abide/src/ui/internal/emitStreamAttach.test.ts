// STREAM ATTACH HANDOFF — CLIENT HALF OF STEP 4b (replayable-streams.md §5).
//
// The headline invariant: an RPC/model `{#for await}` source is NEVER re-invoked on the client at
// hydrate — the client ADOPTS the seeded transcript (mode A, completed) or RESUMES it over the
// resumable HTTP replay (mode B, open) instead of re-running the source. These tests drive the real
// SSR streaming path (install a render stream, render, `collectSeed`) then the emitted `hydrate` with a
// SPIED source, and assert zero client-side source calls + a live/reactive item mount.

import { describe, expect, test } from 'bun:test'
import { collectSeed, type HydrationSeed } from '../../server/internal/pages.ts'
import { RPC_QUERY_PARAMS } from '../../shared/internal/RPC_QUERY_PARAMS.ts'
import { createReactiveScope, enterScope } from '../../shared/internal/reactiveScope.ts'
import { memo } from '../../shared/memo.ts'
import { resumeStreamSource } from './bootstrap.ts'
import { loadEmitted } from './emit.ts'
import { openRenderState } from './renderState.ts'
import { createRenderStream, drainPatches } from './streamScheduler.ts'

function tick(): Promise<void> {
    return Promise.resolve()
}

// Drain all pending microtasks (the seeded-stream pump + the reactive `{#for await}` drain both settle
// over microtasks) by parking behind a macrotask.
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

// SSR a source through the streaming path: install a per-render stream, render the shell, drain
// any streamers (so a streamed list's handle is finalized), and collect the seed. Returns the painted
// HTML + the seed (its `streams` section carries the §5 handoff records).
async function ssrStream(
    source: string,
    serverScope: Record<string, unknown>,
): Promise<{ html: string; seed: HydrationSeed }> {
    const emitted = await loadEmitted(source)
    const ctx = createReactiveScope()
    const streamScheduler = createRenderStream()
    enterScope(ctx, () => {
        openRenderState().stream = streamScheduler
    })
    let html = ''
    await enterScope(ctx, async () => {
        html = await emitted.render(serverScope)
        // Drain any streamer (mode-B / cut-off lists) so the handle's count/done/values are final before
        // `collectSeed`. A fully-inline mode-A list registers no streamer — this is a no-op for it.
        for await (const _patch of drainPatches(streamScheduler)) void _patch
    })
    const seed = enterScope(ctx, () => collectSeed({}))
    return { html, seed }
}

// A finite RPC-shaped streaming source: yields `t0..t{n-1}` with no awaits, so SSR drains it INLINE
// (before the deadline) → completed handoff (mode A).
function makeServerComplete(): (args: { n: number }) => AsyncIterable<string> {
    return (args) =>
        (async function* () {
            for (let i = 0; i < args.n; i++) yield `t${i}`
        })()
}

describe('mode A — completed RPC {#for await} adopts the seeded transcript (no client re-run)', () => {
    const SRC =
        `<script>import complete from '../../server/rpc/complete'</script>` +
        `<ul>{#for await tok of complete({ n: 3 })}<li onclick={() => bump(tok)}>{tok}</li>{/for}</ul>`

    test('the RPC source is never invoked on the client; items render + an item onclick fires', async () => {
        const { html, seed } = await ssrStream(SRC, { complete: makeServerComplete() })

        // The SSR painted the bare id'd sentinel and the SEED carries the decoded transcript inline
        // (mode A). Attachability is a property of the seed, not of a DOM marker: the client matches
        // its region off the memo transcript, so the sentinel needs no count/done attributes.
        expect(html).toContain('<template id="ab-l:0"></template>')
        expect(seed.streams).toBeDefined()
        const streams = seed.streams
        if (streams === undefined) throw new Error('expected seed.streams')
        expect(streams.length).toBe(1)
        const firstStream = streams[0]
        if (firstStream === undefined) throw new Error('expected a stream handle')
        expect(firstStream.done).toBe(true)
        expect(firstStream.values).toEqual(['t0', 't1', 't2'])

        // Hydrate with the SOURCE MODELED AS A SEEDED CELL — exactly what `replayStreams` warms it into on
        // the real client. A read of a warm-seeded stream slot hands back a cursor over the recorded
        // transcript WITHOUT running the underlying source, so the spy (which counts NETWORK invokes) never
        // fires. This is the headline invariant: the source is never re-invoked on the client at hydrate.
        let clientCalls = 0
        const bumped: string[] = []
        const complete = memo((_args: { n: number }): AsyncIterable<string> => {
            clientCalls++
            return (async function* () {})()
        })
        complete.seedStream({ n: 3 }, ['t0', 't1', 't2'])
        const clientScope = {
            complete,
            bump: (t: string): void => {
                bumped.push(t)
            },
        }

        const host = document.createElement('div')
        host.innerHTML = html
        const emitted = await loadEmitted(SRC)
        const dispose = emitted.hydrate(host, clientScope)
        await flush()

        // THE INVARIANT: zero client-side source calls (the seeded transcript was replayed, not re-run).
        expect(clientCalls).toBe(0)

        // The transcript was re-mounted from the seed: 3 items with the right text.
        const lis = host.querySelectorAll('li')
        expect(lis.length).toBe(3)
        expect(Array.from(lis).map((li) => li.textContent)).toEqual(['t0', 't1', 't2'])

        // A reactive/event-wired item mount (not static server HTML): clicking an item fires its handler,
        // capturing that item's value.
        ;(lis[1] as HTMLElement).dispatchEvent(new Event('click'))
        expect(bumped).toEqual(['t1'])

        dispose()
    })

    test('the adopted stream is reactive: chunk probes read the transcript and refresh() re-runs it', async () => {
        const { html } = await ssrStream(SRC, { complete: makeServerComplete() })

        // On refresh the client source IS run — it yields a DIFFERENT transcript so the repaint is visible.
        let runs = 0
        const complete = memo((_args: { n: number }): AsyncIterable<string> => {
            runs++
            return (async function* () {
                yield 'r0'
                yield 'r1'
            })()
        })
        complete.seedStream({ n: 3 }, ['t0', 't1', 't2'])
        const clientScope = { complete, bump: (): void => {} }

        const host = document.createElement('div')
        host.innerHTML = html
        const emitted = await loadEmitted(SRC)
        const dispose = emitted.hydrate(host, clientScope)
        await flush()

        // Adopted from the seed (no source run), and the chunk probes read the seeded transcript.
        expect(runs).toBe(0)
        const text = (): (string | null)[] =>
            Array.from(host.querySelectorAll('li')).map((li) => li.textContent)
        expect(text()).toEqual(['t0', 't1', 't2'])
        expect(complete.chunks({ n: 3 })).toEqual(['t0', 't1', 't2'])
        expect(complete.done({ n: 3 })).toBe(true)
        // `peek` on a raw memo is typed as the source value (`AsyncIterable`); on a stream slot it returns
        // the latest CHUNK at runtime (the RPC surface types this as `C` — here it is a bare memo).
        expect(complete.peek({ n: 3 }) as unknown).toBe('t2')

        // refresh() re-runs the source and the list re-streams from the fresh transcript (clear-and-restream).
        complete.refresh({ n: 3 })
        await flush()
        expect(runs).toBe(1)
        expect(text()).toEqual(['r0', 'r1'])

        dispose()
    })
})

describe('mode B — an OPEN RPC {#for await} resumes over ?__abide_from=<count> (no client re-run)', () => {
    const SRC =
        `<script>import complete from '../../server/rpc/complete'</script>` +
        `<ul>{#for await tok of complete({ n: 5 })}<li>{tok}</li>{/for}</ul>`

    test('adopts the flushed prefix, then resumes the remainder over the resumable replay endpoint', async () => {
        // SSR the completed shape to obtain a real DOM + anchors, then synthesize the CUT-OFF handoff a
        // budget-truncated flush would produce (done:false, a 2-item prefix, resume from count=2). This
        // exercises the client mode-B path deterministically, without racing the SSR budget timer.
        const { html, seed } = await ssrStream(SRC, { complete: makeServerComplete2(5) })
        const streams = seed.streams
        if (streams === undefined) throw new Error('expected seed.streams')
        const handle = streams[0]
        if (handle === undefined) throw new Error('expected a stream handle')
        handle.done = false
        handle.values = ['t0', 't1']

        // The source is modeled as a seeded memo — `replayStreams` warms an OPEN handle with
        // `resumeStreamSource` (prefix + `?__abide_from=` resume). The spy counts NETWORK re-invokes (must stay 0).
        let clientCalls = 0
        const complete = memo((_args: { n: number }): AsyncIterable<string> => {
            clientCalls++
            return (async function* () {})()
        })

        // Stub fetch: serve the remaining chunks (t2..t4) as an application/jsonl replay.
        const fetchUrls: string[] = []
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
            fetchUrls.push(String(input))
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    const encoder = new TextEncoder()
                    for (const value of ['t2', 't3', 't4'])
                        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
                    controller.close()
                },
            })
            return new Response(body, {
                status: 200,
                headers: { 'x-abide-stream-resume': 'live', 'content-type': 'application/jsonl' },
            })
        }) as typeof globalThis.fetch

        try {
            // Seed exactly as `replayStreams` does for an open handle: the flushed prefix (pushed
            // synchronously, so the region can be CLAIMED) plus the resumed tail.
            complete.seedStream(
                { n: 5 },
                {
                    prefix: handle.values ?? [],
                    rest: resumeStreamSource(
                        '',
                        'complete',
                        { n: 5 },
                        handle.values?.length ?? 0,
                        () => {
                            complete.invalidate({ n: 5 })
                        },
                    ),
                },
            )
            const host = document.createElement('div')
            host.innerHTML = html
            // The server's painted nodes. This fixture SSRs the completed shape (5 items) and then
            // synthesizes a cut-off handle over it, so only the 2 items the prefix covers are claimable;
            // a real mode-B paint stops at `count`. Capture them before hydrating — identity is the point.
            const serverItems = Array.from(host.querySelectorAll('li'))
            const emitted = await loadEmitted(SRC)
            const dispose = emitted.hydrate(host, { complete })

            // Let the resume fetch + jsonl reader drain.
            for (let i = 0; i < 50 && host.querySelectorAll('li').length < 5; i++) await flush()

            expect(clientCalls).toBe(0) // the RPC source was NEVER re-invoked
            expect(fetchUrls.length).toBe(1)
            expect(fetchUrls[0]).toContain('/__abide/rpc/complete?__abide_from=2')
            // The RESERVED namespaced param, not a bare `args=` — a stale name would decode as a flat
            // arg field called "args" and the real args would silently vanish.
            expect(fetchUrls[0]).toContain(`&${RPC_QUERY_PARAMS.args}=`)
            const lis = host.querySelectorAll('li')
            expect(Array.from(lis).map((li) => li.textContent)).toEqual([
                't0',
                't1',
                't2',
                't3',
                't4',
            ])
            // THE MODE-B CLAIM: the items the flushed prefix covers are the SAME nodes, not re-created —
            // the case that matters, since any stream slower than the 4ms SSR deadline lands here.
            expect(lis[0]).toBe(serverItems[0])
            expect(lis[1]).toBe(serverItems[1])

            dispose()
        } finally {
            globalThis.fetch = originalFetch
        }
    })
})

describe('regression — the {#await} claim path (unwrapStreamSlot/claimAwait) still works', () => {
    test('a settled {#await} claims its server-resolved branch in place (no pending repaint)', async () => {
        const SRC = `<p>{#await value}<span>loading</span>{:then v}<b>{v}</b>{/await}</p>`
        // A non-thenable read is synchronously settled → claimAwait adopts the server-rendered then-branch.
        const scope = { value: 'hi' }
        const emitted = await loadEmitted(SRC)

        const host = document.createElement('div')
        host.innerHTML = await emitted.render(scope)
        const serverBold = host.querySelector('b')
        if (serverBold === null) throw new Error('expected a server <b>')
        expect(serverBold.textContent).toBe('hi')

        const dispose = emitted.hydrate(host, scope)
        await tick()

        // Same node claimed; the pending branch was never mounted.
        expect(host.querySelector('b')).toBe(serverBold)
        expect(host.textContent).not.toContain('loading')

        dispose()
    })
})

// A finite source that yields `t0..t{n-1}` (for the mode-B fixture; identical shape to
// makeServerComplete but parameterized by a fixed n captured at SSR).
function makeServerComplete2(n: number): () => AsyncIterable<string> {
    return () =>
        (async function* () {
            for (let i = 0; i < n; i++) yield `t${i}`
        })()
}

describe("gating — a non-RPC {#for await} source keeps today's re-run behavior", () => {
    const SRC = `<ul>{#for await x of feed()}<li>{x}</li>{/for}</ul>`

    test('no handle is seeded, and the client RE-INVOKES the (non-RPC) source on hydrate', async () => {
        const { html, seed } = await ssrStream(SRC, {
            feed: () =>
                (async function* () {
                    yield 'a'
                    yield 'b'
                })(),
        })

        // Non-attachable: no list sentinel when it drains inline, and no streams seed.
        expect(html).not.toContain('ab-l:')
        expect(seed.streams).toBeUndefined()

        let clientCalls = 0
        const clientScope = {
            feed: (): AsyncIterable<string> => {
                clientCalls++
                return (async function* () {
                    yield 'a'
                    yield 'b'
                })()
            },
        }

        const host = document.createElement('div')
        host.innerHTML = html
        const emitted = await loadEmitted(SRC)
        const dispose = emitted.hydrate(host, clientScope)
        await tick()
        await tick()

        // Current behavior preserved: the non-RPC source re-runs on the client (it has no handoff).
        expect(clientCalls).toBe(1)

        dispose()
    })
})

describe('resumeStreamSource — mode-B prefix + ?from resume (fresh / failure branches)', () => {
    async function collect(gen: AsyncIterable<unknown>): Promise<unknown[]> {
        const out: unknown[] = []
        for await (const value of gen) out.push(value)
        return out
    }

    function jsonlResponse(values: string[], resume: 'live' | 'fresh'): Response {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                const encoder = new TextEncoder()
                for (const value of values)
                    controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
                controller.close()
            },
        })
        return new Response(body, {
            status: 200,
            headers: { 'x-abide-stream-resume': resume, 'content-type': 'application/jsonl' },
        })
    }

    // The resume now yields ONLY THE TAIL: the flushed prefix is handed to `seedStream` as
    // `StreamSeed.prefix` and pushed synchronously, so the hydrating block can claim the server's painted
    // items in the same tick instead of waiting a microtask for a generator's first yield.
    test('a live resume yields the resumed TAIL only (the prefix is seeded separately)', async () => {
        const original = globalThis.fetch
        globalThis.fetch = (async (_input: RequestInfo | URL): Promise<Response> =>
            jsonlResponse(['t2', 't3'], 'live')) as typeof globalThis.fetch
        try {
            const fresh: number[] = []
            expect(
                await collect(resumeStreamSource('', 'r', { n: 5 }, 2, () => fresh.push(1))),
            ).toEqual(['t2', 't3'])
            expect(fresh.length).toBe(0)
        } finally {
            globalThis.fetch = original
        }
    })

    test('a `fresh` resume (transcript evicted) SIGNALS instead of yielding — the prefix is already in', async () => {
        const original = globalThis.fetch
        globalThis.fetch = (async (_input: RequestInfo | URL): Promise<Response> =>
            jsonlResponse(['f0', 'f1', 'f2'], 'fresh')) as typeof globalThis.fetch
        try {
            let freshCalls = 0
            // Yielding the fresh run here would append it AFTER the already-installed prefix (and after a
            // claim may have bound that prefix to the server's DOM). The caller drops the slot instead, so
            // the block clear-and-restreams — today's behaviour, in the rare eviction case only.
            expect(
                await collect(resumeStreamSource('', 'r', { n: 5 }, 2, () => (freshCalls += 1))),
            ).toEqual([])
            expect(freshCalls).toBe(1)
        } finally {
            globalThis.fetch = original
        }
    })

    test('a failed resume yields nothing — the seeded prefix stands and the stream closes', async () => {
        const original = globalThis.fetch
        globalThis.fetch = (async (_input: RequestInfo | URL): Promise<Response> => {
            throw new Error('offline')
        }) as typeof globalThis.fetch
        try {
            let freshCalls = 0
            expect(
                await collect(resumeStreamSource('', 'r', { n: 5 }, 2, () => (freshCalls += 1))),
            ).toEqual([])
            expect(freshCalls).toBe(0)
        } finally {
            globalThis.fetch = original
        }
    })
})

// SPECIFIER FORMS — which import shapes mark a `{#for await}` source ATTACHABLE.
//
// The attach tag is decided TEXTUALLY from the import specifier's `server/rpc/` segment, so the form the
// scaffolder writes has to be covered. `$server/rpc/<name>` is that form (the tsconfig path alias); it
// once fell through the `(^|/)` anchor, which silently made every aliased stream non-attachable — the
// seed carried no handle, so hydrate re-invoked the RPC and the whole stream ran a SECOND time.
describe('attach recognises every RPC import specifier form', () => {
    const FORMS = [
        ['$server/rpc/complete', 'tsconfig alias (scaffolded form)'],
        ['../../server/rpc/complete', 'relative'],
        ['/src/server/rpc/complete', 'absolute'],
    ] as const

    for (const [specifier, label] of FORMS) {
        test(`${label}: ${specifier} → attachable handoff`, async () => {
            const src =
                `<script>import complete from '${specifier}'</script>` +
                `<ul>{#for await tok of complete({ n: 2 })}<li>{tok}</li>{/for}</ul>`
            const { html, seed } = await ssrStream(src, { complete: makeServerComplete() })

            expect(html).toContain('<template id="ab-l:0"></template>')
            expect(seed.streams?.length).toBe(1)
            expect(seed.streams?.[0]?.name).toBe('complete')
            expect(seed.streams?.[0]?.done).toBe(true)
            expect(seed.streams?.[0]?.values).toEqual(['t0', 't1'])
        })
    }

    test('a non-RPC specifier stays NON-attachable (client re-iterates)', async () => {
        const src =
            `<script>import complete from '$shared/streams/complete'</script>` +
            `<ul>{#for await tok of complete({ n: 2 })}<li>{tok}</li>{/for}</ul>`
        const { html, seed } = await ssrStream(src, { complete: makeServerComplete() })

        // Non-attachable and completed inline: no sentinel and no handoff record at all, so the
        // client re-iterates the source instead of adopting a transcript.
        expect(html).not.toContain('ab-l:')
        expect(seed.streams).toBeUndefined()
    })
})

// SAME-NODE CLAIM (attach-hydration of a streamed region). Until the transcript became reachable
// synchronously (`shared/internal/streamTranscript.ts` + the settled hint on a warm stream read), a
// `{#for await}` hydrate CLEARED the server's painted items and re-created them from the drain — correct,
// but a visible re-paint of the largest region on a streaming page, and node identity was lost. The region
// is now claimed in place: the SAME `<li>` objects survive hydration and are wired.
describe('mode A — the streamed region is CLAIMED in place (same nodes, no re-paint)', () => {
    const SRC =
        `<script>import complete from '../../server/rpc/complete'</script>` +
        `<ul>{#for await tok of complete({ n: 3 })}<li onclick={() => bump(tok)}>{tok}</li>{/for}</ul>`

    test('the server-rendered <li> nodes are the SAME objects after hydrate, and stay interactive', async () => {
        const { html } = await ssrStream(SRC, { complete: makeServerComplete() })

        const complete = memo((_args: { n: number }): AsyncIterable<string> => {
            throw new Error('the client must not invoke a warm-seeded source')
        })
        complete.seedStream({ n: 3 }, ['t0', 't1', 't2'])
        const bumped: string[] = []
        const clientScope = {
            complete,
            bump: (t: string): void => {
                bumped.push(t)
            },
        }

        const host = document.createElement('div')
        host.innerHTML = html
        // Capture the SERVER's nodes before hydrating — identity is the load-bearing assertion.
        const serverItems = Array.from(host.querySelectorAll('li'))
        expect(serverItems.length).toBe(3)
        expect(serverItems.map((li) => li.textContent)).toEqual(['t0', 't1', 't2'])

        const emitted = await loadEmitted(SRC)
        const dispose = emitted.hydrate(host, clientScope)
        await flush()

        const afterItems = Array.from(host.querySelectorAll('li'))
        expect(afterItems.length).toBe(3)
        // NOT re-created: every node is the very object the server's HTML parsed into.
        expect(afterItems[0]).toBe(serverItems[0])
        expect(afterItems[1]).toBe(serverItems[1])
        expect(afterItems[2]).toBe(serverItems[2])
        // Claimed AND wired — the click handler runs against the claimed node.
        ;(afterItems[1] as HTMLElement).dispatchEvent(new Event('click'))
        expect(bumped).toEqual(['t1'])
        // The streaming sentinel is not left behind as stray DOM.
        expect(host.querySelector('template[id^="ab-l:"]')).toBe(null)

        dispose()
    })

    test('a refresh after a claimed hydrate still clears and re-streams (claim is first-run only)', async () => {
        const { html } = await ssrStream(SRC, { complete: makeServerComplete() })

        let runs = 0
        const complete = memo((_args: { n: number }): AsyncIterable<string> => {
            runs++
            return (async function* () {
                yield 'r0'
                yield 'r1'
            })()
        })
        complete.seedStream({ n: 3 }, ['t0', 't1', 't2'])
        const host = document.createElement('div')
        host.innerHTML = html
        const serverFirst = host.querySelector('li')
        const emitted = await loadEmitted(SRC)
        const dispose = emitted.hydrate(host, { complete, bump: (): void => {} })
        await flush()
        expect(runs).toBe(0)
        expect(host.querySelector('li')).toBe(serverFirst) // claimed

        complete.refresh({ n: 3 })
        await flush()
        // The refresh is a genuine clear-and-restream: the source runs, the claimed nodes are gone.
        expect(runs).toBe(1)
        expect(Array.from(host.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
            'r0',
            'r1',
        ])
        dispose()
    })
})
