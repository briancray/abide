import { describe, expect, test } from 'bun:test'
import { done } from '../src/lib/shared/done.ts'
import { peek } from '../src/lib/shared/peek.ts'

/*
ADR-0032: a promise/iterable subexpression peek-lifts to `undefined` while pending, so
`{done(getFeed())}` / `{peek(getFeed())}` in a template hand the probe `undefined` on the
first render pass. The probes must degrade to a graceful pending value rather than throwing
on `subscribable.name` (which turned a pending render into a 500).
*/
describe('probe null-tolerance (ADR-0032 peek-lift)', () => {
    test('done(undefined) is false, not a throw', () => {
        expect(() => done(undefined as never)).not.toThrow()
        expect(done(undefined as never)).toBe(false)
        expect(done(null as never)).toBe(false)
    })

    test('peek(undefined) is undefined, not a throw', () => {
        expect(() => peek(undefined as never)).not.toThrow()
        expect(peek(undefined as never)).toBeUndefined()
        expect(peek(null as never)).toBeUndefined()
    })
})
