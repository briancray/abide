import { describe, expect, test } from 'bun:test'
import { debugGate } from '../src/lib/shared/debugGate.ts'
import { isDebugEnabled } from '../src/lib/shared/isDebugEnabled.ts'
import { isDebugNegated } from '../src/lib/shared/isDebugNegated.ts'

/* The consolidated DEBUG-gate core: matching semantics (wildcards, prefix,
   exact, negation precedence) plus the per-env memo invalidating when DEBUG
   changes — the one risk introduced by caching the partition + decisions. */
describe('debugGate matching semantics', () => {
    test('bare * enables everything', () => {
        const gate = debugGate('*')
        expect(gate.enabled('abide')).toBe(true)
        expect(gate.enabled('abide:cache')).toBe(true)
        expect(gate.enabled('anything')).toBe(true)
    })

    test('prefix:* matches the prefix itself and every sub-channel', () => {
        const gate = debugGate('abide:*')
        expect(gate.enabled('abide')).toBe(true)
        expect(gate.enabled('abide:cache')).toBe(true)
        expect(gate.enabled('abide:rpc:detail')).toBe(true)
        // No false prefix match on a name that merely starts with the string.
        expect(gate.enabled('abiderogue')).toBe(false)
        expect(gate.enabled('other')).toBe(false)
    })

    test('a plain pattern matches exactly', () => {
        const gate = debugGate('abide')
        expect(gate.enabled('abide')).toBe(true)
        expect(gate.enabled('abide:cache')).toBe(false)
    })

    test('comma-separated list and whitespace trimming', () => {
        const gate = debugGate(' a , abide ')
        expect(gate.enabled('a')).toBe(true)
        expect(gate.enabled('abide')).toBe(true)
        expect(gate.enabled('b')).toBe(false)
    })

    test('exclusions win over inclusions (negation precedence)', () => {
        const gate = debugGate('abide:*,-abide:cache')
        expect(gate.enabled('abide:rpc')).toBe(true)
        expect(gate.enabled('abide:cache')).toBe(false)
    })

    test('negated reports only `-` patterns; enabled never true for a purely negated env', () => {
        const gate = debugGate('-app')
        expect(gate.negated('app')).toBe(true)
        expect(gate.negated('abide')).toBe(false)
        // A `-`-only env includes nothing, so a gated channel stays off.
        expect(gate.enabled('app')).toBe(false)
    })

    test('undefined / empty env enables nothing and negates nothing', () => {
        for (const env of [undefined, '', '  ']) {
            const gate = debugGate(env)
            expect(gate.enabled('abide')).toBe(false)
            expect(gate.negated('abide')).toBe(false)
        }
    })
})

describe('debugGate per-env memo invalidation', () => {
    /* The decision is cached per channel name; the cache must be dropped when the
       env string changes (browser localStorage toggle, tests mutating DEBUG).
       Same name, different env, must yield the new env's answer — not a stale hit. */
    test('a changed env string re-decides the same channel name', () => {
        expect(isDebugEnabled('abide:cache', 'abide:*')).toBe(true)
        // Same name, new env that excludes it — must not return the cached `true`.
        expect(isDebugEnabled('abide:cache', '-abide:cache')).toBe(false)
        // And back on again under yet another env.
        expect(isDebugEnabled('abide:cache', 'abide:cache')).toBe(true)
    })

    test('isDebugNegated tracks env changes for the same name', () => {
        expect(isDebugNegated('app', '-app')).toBe(true)
        expect(isDebugNegated('app', 'app')).toBe(false)
    })
})
