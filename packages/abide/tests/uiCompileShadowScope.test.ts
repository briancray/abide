import { describe, expect, test } from 'bun:test'
import { createShadowScope } from '../src/lib/ui/compile/createShadowScope.ts'

/*
The typed auto-popping shadow stack. The load-bearing property is the `finally` pop:
the old hand-written pop ran after the body returned, so a throw mid-body (SSR's
`await then` TDZ path) leaked the branch's shadows into every later sibling, which
then mis-lowered to the component signal. These pin that a branch's shadows cannot
outlive the branch even when the body throws.
*/
describe('createShadowScope', () => {
    test('pushes a name for the body and pops it after', () => {
        const scope = createShadowScope()
        expect(scope.names('derived').has('item')).toBe(false)
        scope.withShadow(['item'], 'derived', () => {
            expect(scope.names('derived').has('item')).toBe(true)
        })
        expect(scope.names('derived').has('item')).toBe(false)
    })

    test('pops in a finally even when the body throws — no leak into later siblings', () => {
        const scope = createShadowScope()
        expect(() =>
            scope.withShadow(['value'], 'plain', () => {
                throw new Error('TDZ-style mid-body crash')
            }),
        ).toThrow('TDZ-style mid-body crash')
        /* The forgotten-pop bug: before the `finally`, this leaked and a later sibling
           mis-lowered. */
        expect(scope.names('plain').has('value')).toBe(false)
    })

    test('kinds are independent — a derived push does not shadow under plain', () => {
        const scope = createShadowScope()
        scope.withShadow(['x'], 'derived', () => {
            expect(scope.names('derived').has('x')).toBe(true)
            expect(scope.names('plain').has('x')).toBe(false)
        })
    })

    test('an outer push survives an inner branch popping the same name', () => {
        const scope = createShadowScope()
        scope.withShadow(['n'], 'derived', () => {
            scope.withShadow(['n'], 'derived', () => {
                expect(scope.names('derived').has('n')).toBe(true)
            })
            /* The inner call added nothing new, so its pop must not remove the outer's name. */
            expect(scope.names('derived').has('n')).toBe(true)
        })
        expect(scope.names('derived').has('n')).toBe(false)
    })
})
