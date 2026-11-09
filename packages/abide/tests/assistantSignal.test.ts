// 44.57 — `assistant`'s own `signal`, against a provider stuck in an await it was never handed a way
// out of: the conversation ends on the abort, refused `aborted`, without waiting for the provider.

import { expect, test } from 'bun:test'

import { assistant, type Provider } from '../src/server/assistant.ts'
import { inScope } from '../src/server/requestScope.ts'
import { isFailed } from '../src/shared/Failed.ts'

const NEVER = new Promise<never>(() => {})

/** A provider that says one thing and then waits forever, and the signal it was handed. */
function stuckProvider(): { provider: Provider; handed: AbortSignal[] } {
    const handed: AbortSignal[] = []
    return {
        handed,
        provider: {
            async *run(_messages, _tools, { signal }) {
                handed.push(signal)
                yield { type: 'text', text: 'thinking' }
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
            value: { type: 'text', text: 'thinking' },
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
