import { describe, expect, test } from 'bun:test'
import { stripEffects } from '../src/lib/ui/compile/stripEffects.ts'

/* The SSR back-end blanks client reaction calls to `undefined`. Both `effect` and its
   replacement `watch` are stripped bare; `watch` is bare-only (an unrelated `.watch`
   member survives), while the legacy `.effect` scope method is still matched. */
describe('stripEffects', () => {
    test('blanks a bare effect and a bare watch', () => {
        expect(stripEffects('effect(() => run())')).toContain('undefined')
        const stripped = stripEffects('watch(count, (n) => run(n))')
        expect(stripped).toContain('undefined')
        expect(stripped).not.toContain('watch(count')
    })

    test('keeps an unrelated `.watch` member call intact', () => {
        const out = stripEffects('emitter.watch(handler)')
        expect(out).toContain('emitter.watch(handler)')
    })

    test('a `const stop = watch(...)` keeps a defined (unused) name', () => {
        expect(stripEffects('const stop = watch(src, fn)')).toContain('const stop = undefined')
    })
})
