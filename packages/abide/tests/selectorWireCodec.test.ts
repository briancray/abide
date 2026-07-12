import { describe, expect, test } from 'bun:test'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import { matcherFromEnvelope } from '../src/lib/shared/matcherFromEnvelope.ts'
import { selectorMatcher } from '../src/lib/shared/selectorMatcher.ts'
import { selectorPrefix } from '../src/lib/shared/selectorPrefix.ts'
import { serializeSelector } from '../src/lib/shared/serializeSelector.ts'
import type { CacheEntry } from '../src/lib/shared/types/CacheEntry.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

/* A minimal CacheEntry stub — only `key` and `tags` drive the predicates under test. */
function entry(key: string, tags?: string[]): CacheEntry {
    return {
        key,
        promise: Promise.resolve(),
        ttl: undefined,
        expiresAt: undefined,
        tags: tags === undefined ? undefined : new Set(tags),
    }
}

/* The rebuilt (wire round-tripped) predicate must accept exactly the same entries the
   local selectorMatcher would — no drift between encode and decode. */
function assertSameMatch(
    rebuilt: (e: CacheEntry) => boolean,
    local: (e: CacheEntry) => boolean,
    entries: CacheEntry[],
): void {
    for (const e of entries) {
        expect(rebuilt(e)).toBe(local(e))
    }
}

describe('selector wire codec (serializeSelector ⇄ matcherFromEnvelope)', () => {
    const getUser = createRemoteFunction<{ id: number }, { name: string }>({
        method: 'GET',
        url: '/rpc/user',
        clients: BROWSER_ONLY,
        buildRequest: (args) => new Request(`http://x/rpc/user?id=${args?.id}`),
        invoke: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    })

    const entries = [
        entry(keyForRemoteCall('GET', '/rpc/user', undefined)),
        entry(keyForRemoteCall('GET', '/rpc/user', { id: 1 })),
        entry(keyForRemoteCall('GET', '/rpc/user', { id: 2 })),
        entry('GET /rpc/other'),
        entry('GET /rpc/tagged', ['posts']),
        entry('GET /rpc/tagged2', ['posts', 'feed']),
        entry('GET /rpc/untagged'),
    ]

    test('round-trips a fn selector (prefix) — matches every args-variant', () => {
        const frame = serializeSelector('invalidate', getUser)
        expect(frame).toEqual({
            op: 'invalidate',
            mode: 'prefix',
            match: 'GET /rpc/user',
            tags: [],
        })
        assertSameMatch(
            matcherFromEnvelope(frame),
            selectorMatcher(getUser, undefined, selectorPrefix(getUser)),
            entries,
        )
    })

    test('round-trips a fn+args selector (key) — matches exactly that call', () => {
        const frame = serializeSelector('refresh', getUser, { id: 1 })
        expect(frame.op).toBe('refresh')
        expect(frame.mode).toBe('key')
        expect(frame.match).toBe(keyForRemoteCall('GET', '/rpc/user', { id: 1 }))
        assertSameMatch(
            matcherFromEnvelope(frame),
            selectorMatcher(getUser, { id: 1 }, selectorPrefix(getUser, { id: 1 })),
            entries,
        )
    })

    test('round-trips a { tags } selector — matches any shared tag', () => {
        const frame = serializeSelector('invalidate', { tags: ['posts'] })
        expect(frame).toEqual({ op: 'invalidate', mode: 'tags', match: '', tags: ['posts'] })
        assertSameMatch(matcherFromEnvelope(frame), selectorMatcher({ tags: ['posts'] }), entries)
    })

    test('rejects a producer/closure selector (not cross-client serializable)', () => {
        const produce = async () => 42
        expect(() => serializeSelector('invalidate', produce)).toThrow(/not cross-client/)
    })

    test('rejects the bare match-all selector', () => {
        expect(() => serializeSelector('refresh')).toThrow(/match-all/)
    })

    test('rejects a tag-less { tags } selector', () => {
        expect(() => serializeSelector('invalidate', {})).toThrow(/at least one tag/)
    })

    test('rejects an empty { tags: [] } selector (would broadcast a match-nothing frame)', () => {
        expect(() => serializeSelector('invalidate', { tags: [] })).toThrow(/at least one tag/)
    })
})
