import { describe, expect, test } from 'bun:test'
import { analyzeComponent } from '../src/lib/ui/compile/analyzeComponent.ts'

const withCss = (css: string) => `<p>hi</p>\n<style>${css}</style>`
const scopeOf = (source: string, seed?: string) =>
    analyzeComponent(source, seed).styles[0]?.attribute

describe('scope id', () => {
    test('seeded by module id: a CSS edit keeps the same attribute', () => {
        const before = scopeOf(withCss('p { color: red }'), 'src/ui/Card.abide')
        const after = scopeOf(withCss('p { color: blue }'), 'src/ui/Card.abide')
        expect(before).toBeDefined()
        expect(after).toBe(before)
    })

    test('different components get different attributes from the same CSS', () => {
        const css = 'p { color: red }'
        expect(scopeOf(withCss(css), 'src/ui/A.abide')).not.toBe(
            scopeOf(withCss(css), 'src/ui/B.abide'),
        )
    })

    test('without a seed it falls back to hashing the CSS body', () => {
        expect(scopeOf(withCss('p { color: red }'))).not.toBe(scopeOf(withCss('p { color: blue }')))
    })

    test('no style block yields no scope attribute', () => {
        expect(scopeOf('<p>hi</p>', 'src/ui/Card.abide')).toBeUndefined()
    })
})
