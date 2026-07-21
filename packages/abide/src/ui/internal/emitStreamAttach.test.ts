// STREAM ATTACH HANDOFF — CLIENT HALF OF STEP 4b (replayable-streams.md §5).
//
// The headline invariant: an RPC/model `{#for await}` source is NEVER re-invoked on the client at
// hydrate — the client ADOPTS the seeded transcript (mode A, completed) or RESUMES it over the
// resumable HTTP replay (mode B, open) instead of re-running the source. These tests drive the real
// SSR streaming path (install a StreamScope, render, `collectSeed`) then the emitted `hydrate` with a
// SPIED source, and assert zero client-side source calls + a live/reactive item mount.

import { describe, expect, test } from 'bun:test'
import { collectSeed, type HydrationSeed } from '../../server/internal/pages.ts'
import { createContext, runInContext } from '../../shared/internal/context.ts'
import { loadEmitted } from './emit.ts'
import { beginStreamHandoff, endStreamHandoff } from './runtime.ts'
import { createStreamScope, drainPatches } from './streamScope.ts'

function tick(): Promise<void> {
    return Promise.resolve()
}

// SSR a source through the streaming path: install a per-render StreamScope, render the shell, drain
// any streamers (so a streamed list's handle is finalized), and collect the seed. Returns the painted
// HTML + the seed (its `streams` section carries the §5 handoff records).
async function ssrStream(
    source: string,
    serverScope: Record<string, unknown>,
): Promise<{ html: string; seed: HydrationSeed }> {
    const emitted = await loadEmitted(source)
    const ctx = createContext()
    const streamScope = createStreamScope()
    ctx.stream = streamScope
    let html = ''
    await runInContext(ctx, async () => {
        html = await emitted.render(serverScope)
        // Drain any streamer (mode-B / cut-off lists) so the handle's count/done/values are final before
        // `collectSeed`. A fully-inline mode-A list registers no streamer — this is a no-op for it.
        for await (const _patch of drainPatches(streamScope)) void _patch
    })
    const seed = runInContext(ctx, () => collectSeed({}))
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

        // The SSR painted an <abide-list> with a data-ab-count and the completed marker, and the seed
        // carries the decoded transcript inline (mode A).
        expect(html).toContain('<abide-list')
        expect(html).toContain('data-ab-count="3"')
        expect(html).toContain('data-ab-done')
        expect(seed.streams).toBeDefined()
        const streams = seed.streams
        if (streams === undefined) throw new Error('expected seed.streams')
        expect(streams.length).toBe(1)
        const firstStream = streams[0]
        if (firstStream === undefined) throw new Error('expected a stream handle')
        expect(firstStream.done).toBe(true)
        expect(firstStream.values).toEqual(['t0', 't1', 't2'])

        // Hydrate with a SPY source: it must never be called on the client.
        let clientCalls = 0
        const bumped: string[] = []
        const clientScope = {
            complete: (): AsyncIterable<string> => {
                clientCalls++
                return (async function* () {})()
            },
            bump: (t: string): void => {
                bumped.push(t)
            },
        }

        const host = document.createElement('div')
        host.innerHTML = html
        const emitted = await loadEmitted(SRC)
        beginStreamHandoff(seed.streams, '')
        const dispose = emitted.hydrate(host, clientScope)
        endStreamHandoff()
        await tick()

        // THE INVARIANT: zero client-side source calls.
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
})

describe('mode B — an OPEN RPC {#for await} resumes over ?from=<count> (no client re-run)', () => {
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
        handle.count = 2
        handle.values = ['t0', 't1']

        let clientCalls = 0
        const clientScope = {
            complete: (): AsyncIterable<string> => {
                clientCalls++
                return (async function* () {})()
            },
        }

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
            const host = document.createElement('div')
            host.innerHTML = html
            const emitted = await loadEmitted(SRC)
            beginStreamHandoff(seed.streams, '')
            const dispose = emitted.hydrate(host, clientScope)
            endStreamHandoff()

            // Let the resume fetch + jsonl reader drain.
            for (let i = 0; i < 50 && host.querySelectorAll('li').length < 5; i++) await tick()

            expect(clientCalls).toBe(0) // the RPC source was NEVER re-invoked
            expect(fetchUrls.length).toBe(1)
            expect(fetchUrls[0]).toContain('/rpc/complete?from=2')
            expect(fetchUrls[0]).toContain('args=')
            const lis = host.querySelectorAll('li')
            expect(Array.from(lis).map((li) => li.textContent)).toEqual([
                't0',
                't1',
                't2',
                't3',
                't4',
            ])

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

        // Non-attachable: no <abide-list> when it drains inline, and no streams seed.
        expect(html).not.toContain('<abide-list')
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
        beginStreamHandoff(seed.streams, '')
        const dispose = emitted.hydrate(host, clientScope)
        endStreamHandoff()
        await tick()
        await tick()

        // Current behavior preserved: the non-RPC source re-runs on the client (it has no handoff).
        expect(clientCalls).toBe(1)

        dispose()
    })
})
