import { describe, expect, test } from 'bun:test'
import { lowerDocAccess } from '../src/lib/ui/compile/lowerDocAccess.ts'
import { doc } from '../src/lib/ui/doc.ts'
import type { Doc } from '../src/lib/ui/runtime/types/Doc.ts'

/* Normalises printer whitespace so substring assertions are stable. */
function lower(code: string): string {
    return lowerDocAccess(code, 'model').replace(/\s+/g, ' ').trim()
}

describe('lowerDocAccess — emitted shape', () => {
    test('assignment becomes a replace patch', () => {
        expect(lower("model.note = 'x'")).toContain('model.replace("note", \'x\')')
    })

    test('nested static path folds into one string literal', () => {
        expect(lower('model.lines[0].sku')).toContain('model.read("lines/0/sku")')
    })

    test('a dynamic index becomes a concatenated path', () => {
        expect(lower('model.lines[i].sku')).toContain('model.read("lines/" + i + "/sku")')
    })

    test('compound assignment reads then replaces', () => {
        expect(lower('model.count += 1')).toContain(
            'model.replace("count", model.read("count") + 1)',
        )
    })

    test('array push becomes an add patch at the - slot', () => {
        expect(lower('model.lines.push(v)')).toContain('model.add("lines/-", v)')
    })

    test('delete becomes a remove patch', () => {
        expect(lower('delete model.byId[key]')).toContain('model.remove("byId/" + key)')
    })

    test('a read used as an index lowers too', () => {
        expect(lower('model.lines[model.cursor].sku')).toContain(
            'model.read("lines/" + model.read("cursor") + "/sku")',
        )
    })

    test('non-doc identifiers are left untouched', () => {
        expect(lower('other.foo = 1')).toContain('other.foo = 1')
    })
})

/* Runs lowered source against a real document by binding `model`. */
function run(document: Doc, body: string): unknown {
    const lowered = lowerDocAccess(body, 'model')
    return new Function('model', lowered)(document)
}

describe('lowerDocAccess — executed semantics', () => {
    test('lowered reads and writes drive the document', () => {
        const d = doc({ note: 'a', lines: [{ sku: 'x' }] })
        run(d, "model.note = 'b'")
        expect(d.read<string>('note')).toBe('b')
        expect(run(d, 'return model.lines[0].sku')).toBe('x')
    })

    test('lowered push and compound assignment patch correctly', () => {
        const d = doc({ count: 1, lines: ['a'] })
        run(d, 'model.count += 4')
        expect(d.read<number>('count')).toBe(5)
        run(d, "model.lines.push('b')")
        expect(d.read<string[]>('lines')).toEqual(['a', 'b'])
    })

    test('lowered dynamic-index read resolves through the path', () => {
        const d = doc({ lines: [{ sku: 'x' }, { sku: 'y' }] })
        expect(run(d, 'const i = 1; return model.lines[i].sku')).toBe('y')
    })
})
