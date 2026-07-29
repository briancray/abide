// CO2.4 — `health()` composes the WHOLE document on the server: baseline, bind clock, and the app's
// `onHealth` fields merged over it. The route's own tests (`server/internal/health.test.ts`) prove the
// same rules over HTTP; these prove them for an in-proc caller, which is the half that used to answer
// `{ reachable, version }` and nothing else.

import { describe, expect, test } from 'bun:test'
import { health } from './health.ts'
import { provideHealthSource } from './internal/healthSource.ts'

// The document as a bag, because THIS package declares no `onHealth` — the app fields these tests
// assert are exactly the ones the generated companion types for an app that does
// (`cli/writeHealthCompanion.test.ts` compiles that half).
async function document(): Promise<Record<string, unknown>> {
    return (await health()) as unknown as Record<string, unknown>
}

// Every case registers its own source and withdraws it, so one test's app never answers for another's
// — the property the registration STACK exists to give (see `healthSource.ts`).
async function withSource(
    source: Parameters<typeof provideHealthSource>[0],
): Promise<Record<string, unknown>> {
    const withdraw = provideHealthSource(source)
    try {
        return await document()
    } finally {
        withdraw()
    }
}

describe('health()', () => {
    test('with no app bound it answers the framework baseline', async () => {
        const baseline = await document()
        expect(baseline.reachable).toBe(true)
        expect(typeof baseline.version).toBe('string')
        // The process is the honest clock when nothing bound a server.
        expect(typeof baseline.startedAt).toBe('string')
        expect(baseline.uptime as number).toBeGreaterThanOrEqual(0)
    })

    test('the bound app supplies the clock', async () => {
        const startedAt = Date.now() - 5_000
        const document = await withSource({ startedAt })
        expect(document.startedAt).toBe(new Date(startedAt).toISOString())
        expect(document.uptime as number).toBeGreaterThanOrEqual(5_000)
    })

    test('onHealth fields merge over the baseline', async () => {
        const document = await withSource({ startedAt: Date.now(), onHealth: () => ({ db: 'ok' }) })
        expect(document.db).toBe('ok')
        expect(document.reachable).toBe(true)
        expect(typeof document.version).toBe('string')
    })

    test('onHealth wins over the baseline it merges onto', async () => {
        const document = await withSource({
            startedAt: Date.now(),
            onHealth: () => ({ reachable: false }),
        })
        expect(document.reachable).toBe(false)
    })

    test('an async onHealth is awaited', async () => {
        const document = await withSource({
            startedAt: Date.now(),
            onHealth: async () => ({ db: 'slow' }),
        })
        expect(document.db).toBe('slow')
    })

    test('a throwing onHealth fails closed without leaking the error', async () => {
        const document = await withSource({
            startedAt: Date.now(),
            onHealth: () => {
                throw new Error('db unreachable secret detail')
            },
        })
        expect(document.reachable).toBe(false)
        expect(JSON.stringify(document)).not.toContain('secret detail')
    })

    test('a non-object onHealth return is ignored rather than spread', async () => {
        const document = await withSource({ startedAt: Date.now(), onHealth: () => 'nope' })
        expect(document.reachable).toBe(true)
        // `{...'nope'}` would splat the string into index keys — the document must stay the baseline.
        expect(document['0']).toBeUndefined()
    })

    test('withdrawing a source restores the previous one — a stopped app stops answering', async () => {
        const outer = provideHealthSource({
            startedAt: Date.now(),
            onHealth: () => ({ app: 'outer' }),
        })
        try {
            const inner = provideHealthSource({
                startedAt: Date.now(),
                onHealth: () => ({ app: 'inner' }),
            })
            expect((await document()).app).toBe('inner')
            inner()
            expect((await document()).app).toBe('outer')
            // Idempotent: a second withdraw must not pop the frame it no longer owns.
            inner()
            expect((await document()).app).toBe('outer')
        } finally {
            outer()
        }
    })
})
