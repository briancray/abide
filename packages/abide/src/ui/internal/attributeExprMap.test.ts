// An attribute's expression must map back to the EXPRESSION, not to the attribute name.
//
// `refExpr` was handed the attribute NODE span, which starts at the name, and `locate` takes the first
// `indexOf` — so wherever the name contains the expression text (`onclick={click}`, `count={count}`,
// `title={title}`) the recorded `origStart` pointed into the name. The copied bytes are identical
// either way, so the verbatim-copy invariant test cannot see it; only the map is wrong.

import { describe, expect, test } from 'bun:test'
import { emitCheck } from './emitCheck.ts'
import { parse } from './parse.ts'

function mapping(source: string, expression: string) {
    const emitted = emitCheck(source, parse(source))
    // Where the expression really starts, and whether any copied segment claims to come from there.
    const realStart = source.indexOf(`{${expression}}`) + 1
    const segment = emitted.segments.find(
        (s) => s.genEnd - s.genStart === expression.length && s.origStart === realStart,
    )
    return { realStart, found: segment !== undefined, segments: emitted.segments }
}

describe('an attribute expression maps to itself, not to the attribute name', () => {
    for (const [name, source, expression] of [
        [
            'an event handler whose name contains the expression',
            '<button onclick={click}>x</button>',
            'click',
        ],
        ['a prop whose name equals the expression', '<Card count={count}/>', 'count'],
        ['an attribute whose name equals the expression', '<p title={title}>x</p>', 'title'],
    ] as const) {
        test(name, () => {
            const { found } = mapping(source, expression)
            expect(found).toBe(true)
        })
    }

    // The control: an attribute whose name shares nothing with its expression always mapped correctly,
    // so it must keep doing so.
    test('an attribute sharing nothing with its expression is unaffected', () => {
        const { found } = mapping('<p title={label}>x</p>', 'label')
        expect(found).toBe(true)
    })
})
