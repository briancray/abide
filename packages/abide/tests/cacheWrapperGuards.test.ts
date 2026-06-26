import { describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'

/*
The CACHE_WRAPPED brand turns two previously-silent misuses into throws:
a wrapper used as a selector (matched nothing) and a re-wrapped wrapper
(downgraded a remote to an anonymous producer). Selector misuse routes
through selectorMatcher, so one guard covers pending, refreshing, and
cache.invalidate alike.
*/
describe('cache() wrapper brand guards', () => {
    const getPost = defineRpc('GET', '/rpc/wrapper-guard-post', () => json({ ok: true }))

    test('a wrapper used as a probe selector throws', () => {
        const wrapped = cache(getPost)
        expect(() => pending(wrapped as never)).toThrow('not a selector')
        expect(() => refreshing(wrapped as never)).toThrow('not a selector')
    })

    test('a wrapper used as an invalidate selector throws', () => {
        const wrapped = cache(getPost)
        expect(() => cache.invalidate(wrapped as never)).toThrow('not a selector')
    })

    test('a producer wrapper is rejected the same way', () => {
        async function fetchRates(): Promise<number> {
            return 1
        }
        const wrapped = cache(fetchRates)
        expect(() => pending(wrapped as never)).toThrow('not a selector')
    })

    test('re-wrapping a wrapper throws at wrap time', () => {
        const wrapped = cache(getPost)
        expect(() => cache(wrapped as never)).toThrow('already a cache() wrapper')
    })

    test('the wrapped function itself stays a valid selector', () => {
        cache(getPost)
        expect(pending(getPost)).toBe(false)
        expect(() => cache.invalidate(getPost)).not.toThrow()
    })
})
