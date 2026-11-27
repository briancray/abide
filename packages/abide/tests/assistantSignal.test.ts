// 44.57 — `assistant`'s own `signal`, against a provider stuck in an await it was never handed a way
// out of: the conversation ends on the abort, refused `aborted`, without waiting for the provider.

import { expect, test } from 'bun:test'

import { assistant, type Provider } from '../src/server/assistant.ts'
import { rpc } from '../src/server/index.ts'
import { inScope } from '../src/server/requestScope.ts'
import { isFailed } from '../src/shared/Failed.ts'
import {
    abortStopSignal,
    renewStopSignal,
} from '../src/shared/reactive/abortSignal.ts'

const NEVER = new Promise<never>(() => {})

/** A provider that streams one event and then waits forever, and the signal it was handed. */
function stuckProvider(): { provider: Provider; handed: AbortSignal[] } {
    const handed: AbortSignal[] = []
    return {
        handed,
        provider: {
            async *run(_messages, _tools, { signal }) {
                handed.push(signal)
                yield { type: 'ping' }
                await NEVER
            },
        },
    }
}

const ASKED = [{ role: 'user' as const, content: 'hello' }]

// THE REVERT: yield the provider's events unraced (`endedBy` out), with or without the caller's
// signal joined to the request's; the second `next()` never settles, and the race reads `hung`.
test('a caller aborting its signal ends a conversation whose provider is stuck — 44.57', async () => {
    const { provider, handed } = stuckProvider()
    const caller = new AbortController()
    const requested = new Request('http://localhost/ask')
    await inScope(requested, async () => {
        const events = assistant(ASKED, provider, { signal: caller.signal })
        expect(await events.next()).toEqual({
            done: false,
            value: { type: 'ping' },
        })
        const pending = events.next()
        caller.abort()
        const ended = await Promise.race([
            pending.then(
                (step) => ({ step }),
                (thrown: unknown) => ({ thrown }),
            ),
            Bun.sleep(1_000).then(() => 'hung' as const),
        ])
        expect(ended).not.toBe('hung')
        const thrown = (ended as { thrown?: unknown }).thrown
        expect(isFailed(thrown) && thrown.status).toBe(499)
        expect(handed[0]?.aborted).toBe(true)
        expect(requested.signal.aborted).toBe(false)
    })
})

test('a caller signal already aborted ends the conversation before its first event — 44.57', async () => {
    const { provider } = stuckProvider()
    await inScope(new Request('http://localhost/ask'), async () => {
        const events = assistant(ASKED, provider, {
            signal: AbortSignal.abort(),
        })
        const thrown = await events.next().catch((error: unknown) => error)
        expect(isFailed(thrown) && thrown.status).toBe(499)
    })
})

// The same end for the request's own signal — a client leaving — as for the caller's.
// THE REVERT: `endedBy` out; the race reads `hung`.
test('a request aborting ends a conversation whose provider is stuck — 44.57', async () => {
    const { provider, handed } = stuckProvider()
    const client = new AbortController()
    await inScope(
        new Request('http://localhost/ask', { signal: client.signal }),
        async () => {
            const events = assistant(ASKED, provider)
            await events.next()
            const pending = events.next().catch((error: unknown) => error)
            client.abort()
            const thrown = await Promise.race([
                pending,
                Bun.sleep(1_000).then(() => 'hung' as const),
            ])
            expect(isFailed(thrown) && thrown.status).toBe(499)
            expect(handed[0]?.aborted).toBe(true)
        },
    )
})

// 44.57, 44.101 — A `global` VALUE'S CONVERSATION, mdn's shape: a one-shot turn streamed by a `GET`
// declaring `global`, its answer shared by every reader. No request owns the run, so the first reader
// leaving is not the end of it — the app stopping is (7.20).
// The run is in the first reader's request scope, as every `global` entry's is. THE REVERT: read the
// request off that scope without asking `inGlobalRun`; the provider is handed the reader's signal,
// and the reader leaving aborts it — `true` where `false` is due.
test('a global handler streams a conversation its first reader leaving does not end — 44.57, 44.101, 11.39', async () => {
    const { provider, handed } = stuckProvider()
    const implications = rpc(
        async function* ({ path }: { path: string }) {
            yield* assistant(
                [{ role: 'user', content: `implications of ${path}` }],
                provider,
            )
        },
        { global: true, ttl: 60_000 },
    )
    const reader = new AbortController()
    const said: unknown[] = []
    await inScope(
        new Request('http://localhost/implications', { signal: reader.signal }),
        async () => {
            const answer = implications({
                path: 'css/has',
            }) as unknown as AsyncIterable<unknown>
            for await (const chunk of answer) {
                said.push(chunk)
                break
            }
        },
    )
    reader.abort()
    expect(said).toEqual([{ type: 'ping' }])
    expect(handed[0]?.aborted).toBe(false)
    abortStopSignal()
    expect(handed[0]?.aborted).toBe(true)
    renewStopSignal()
})

// 44.101 — outside a request, with no window to act as, a conversation asked for tools has no one
// for them to act as.
test('a conversation outside a request asked for tools throws — 44.101', async () => {
    const { provider } = stuckProvider()
    const thrown = await assistant(ASKED, provider, { tools: true })
        .next()
        .catch((error: unknown) => error)
    expect((thrown as Error).message).toContain('RULEBOOK 44.101')
})
