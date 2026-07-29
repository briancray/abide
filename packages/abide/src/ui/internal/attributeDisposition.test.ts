// The attribute-value rule, asserted DIRECTLY — which is the point of it having an owner.
//
// It used to live twice, once per substrate, reachable only through a rendered HTML string or a live
// DOM mutation. So the two spellings could disagree without any test being able to compare them, and
// they did: the `planParity` harness manages the known asymmetries with an exclusion list, and the one
// below was invisible to it because a spread-with-handler fixture is excluded on the client side.

import { describe, expect, test } from 'bun:test'
import {
    attributeDisposition,
    directiveIsOn,
    isSpreadHandler,
    styleDirectiveApplies,
} from './attributeDisposition.ts'
import { applyAttribute, spread } from './runtime.ts'
import { applyExpr, applySpread, attrBuilder } from './serverRuntime.ts'

describe('the value rule', () => {
    test('false / null / undefined omit the attribute', () => {
        for (const value of [false, null, undefined]) {
            expect(attributeDisposition(value)).toEqual({ kind: 'omit' })
        }
    })

    test('true is bare; everything else is its string form', () => {
        expect(attributeDisposition(true)).toEqual({ kind: 'bare' })
        expect(attributeDisposition(0)).toEqual({ kind: 'text', text: '0' })
        expect(attributeDisposition('')).toEqual({ kind: 'text', text: '' })
        expect(attributeDisposition(12)).toEqual({ kind: 'text', text: '12' })
    })

    // `class:` is truthiness (a `0` is off); `style:` is presence (a `0` is a legitimate value).
    test('the two directives differ on falsy-but-present values, on purpose', () => {
        expect(directiveIsOn(0)).toBe(false)
        expect(styleDirectiveApplies(0)).toBe(true)
        expect(styleDirectiveApplies(false)).toBe(false)
        expect(styleDirectiveApplies(null)).toBe(false)
    })
})

describe('a spread entry', () => {
    // BY THE VALUE, never by the key. Keying on the name was the bug: the client asked
    // `/^on[a-z]/.test(key)`, which `onClick` fails, so it fell through to `setAttribute` and wrote the
    // function's SOURCE TEXT into the DOM — where a browser treats it as an inline handler and runs it.
    test('a function is a handler whatever its key is spelled like', () => {
        const fn = (): void => {}
        for (const key of ['onclick', 'onClick', 'onCLICK', 'whatever']) {
            expect(isSpreadHandler(fn)).toBe(true)
            expect(key.length).toBeGreaterThan(0)
        }
        expect(isSpreadHandler('onclick')).toBe(false)
        expect(isSpreadHandler(null)).toBe(false)
    })

    // The two substrates through their real entry points: the server drops a handler for want of a live
    // node, the client attaches it as a property. Neither writes it as an attribute.
    test('neither substrate turns a handler into an attribute', () => {
        const handler = (event: unknown): unknown => event

        const builder = attrBuilder()
        applySpread(builder, { onClick: handler, id: 'x' })
        const rendered = builder.serialize()
        expect(rendered).toContain('id="x"')
        expect(rendered).not.toContain('onClick')
        expect(rendered).not.toContain('=>')

        const element = document.createElement('div')
        const dispose = spread(element, () => ({ onClick: handler, id: 'x' }))
        expect(element.getAttribute('id')).toBe('x')
        expect(element.getAttribute('onclick')).toBeNull()
        expect(element.outerHTML).not.toContain('=>')
        expect((element as unknown as Record<string, unknown>).onClick).toBe(handler)
        dispose()
    })
})

describe('both substrates apply the shared rule', () => {
    test.each([
        [false, null],
        [null, null],
        [undefined, null],
        [true, ''],
        [0, '0'],
        ['', ''],
        ['hi', 'hi'],
    ])('%p renders and mounts to the same attribute value', (value, expected) => {
        const builder = attrBuilder()
        applyExpr(builder, 'data-x', value)
        const rendered = builder.serialize()

        const element = document.createElement('div')
        applyAttribute(element, 'data-x', value)
        const mounted = element.getAttribute('data-x')

        expect(mounted).toBe(expected as string | null)
        if (expected === null) expect(rendered).not.toContain('data-x')
        else expect(rendered).toContain('data-x')
    })
})
