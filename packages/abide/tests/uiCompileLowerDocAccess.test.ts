import { describe, expect, test } from 'bun:test'
import { lowerDocAccess } from '../src/lib/ui/compile/lowerDocAccess.ts'
import { readCall } from '../src/lib/ui/dom/readCall.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { escapeKey } from '../src/lib/ui/runtime/escapeKey.ts'
import type { Doc } from '../src/lib/ui/runtime/types/Doc.ts'

/* Normalises printer whitespace so substring assertions are stable. */
function lower(code: string): string {
    return lowerDocAccess(code, 'model').replace(/\s+/g, ' ').trim()
}

describe('lowerDocAccess — emitted shape', () => {
    test('assignment becomes a replace patch', () => {
        expect(lower("model.note = 'x'")).toContain('model.replace("note", \'x\')')
    })

    test('increment/decrement on a doc path becomes a replace patch', () => {
        /* `n++` would otherwise leave `model.read("n")++` (or `cell.get()++`) — invalid,
           a call result is not an lvalue. Postfix and prefix lower identically. */
        expect(lower('model.n++')).toContain('model.replace("n", model.read("n") + 1)')
        expect(lower('++model.n')).toContain('model.replace("n", model.read("n") + 1)')
        expect(lower('model.n--')).toContain('model.replace("n", model.read("n") - 1)')
    })

    test('a non-inc/dec unary operator lowers its operand as a normal read', () => {
        expect(lower('-model.n')).toContain('-model.read("n")')
        expect(lower('!model.flag')).toContain('!model.read("flag")')
    })

    test('nested static path folds into one string literal', () => {
        expect(lower('model.lines[0].sku')).toContain('model.read("lines/0/sku")')
    })

    test('a dynamic index becomes a concatenated path, escaped at runtime', () => {
        expect(lower('model.lines[i].sku')).toContain(
            'model.read("lines/" + $$escapeKey(i) + "/sku")',
        )
    })

    test('a literal key holding / or ~ is escaped at compile time', () => {
        // RFC 6901: `/`→`~1`, `~`→`~0`, so the key addresses one segment, not many
        expect(lower('model.byId["a/b"]')).toContain('model.read("byId/a~1b")')
        expect(lower('model["x~y"]')).toContain('model.read("x~0y")')
    })

    test('compound assignment reads then replaces', () => {
        expect(lower('model.count += 1')).toContain(
            'model.replace("count", model.read("count") + 1)',
        )
    })

    test('logical assignment reads then replaces with the combined value', () => {
        expect(lower("model.text ||= 'x'")).toContain(
            'model.replace("text", model.read("text") || \'x\')',
        )
        expect(lower('model.count ??= 0')).toContain(
            'model.replace("count", model.read("count") ?? 0)',
        )
        expect(lower('model.flag &&= false')).toContain(
            'model.replace("flag", model.read("flag") && false)',
        )
    })

    test('array push becomes an add patch at the - slot', () => {
        expect(lower('model.lines.push(v)')).toContain('model.add("lines/-", v)')
    })

    test('a called member reads the receiver and guards the method on the value', () => {
        // a method call is not a deeper path: `draft.trim()` ≠ read("draft/trim"). It routes
        // through `readCall`, carrying the path + member so a nullish read throws naming them.
        expect(lower('model.draft.trim()')).toContain(
            '$$readCall(model.read("draft"), "draft", "trim", [])',
        )
        expect(lower('model.name.toUpperCase()')).toContain(
            '$$readCall(model.read("name"), "name", "toUpperCase", [])',
        )
    })

    test('a method on a nested path reads up to the method, then guards the call', () => {
        // only the first call is on the doc read; the chained `.map` runs on its result.
        expect(lower('model.items.filter(a => a).map(b => b)')).toContain(
            '$$readCall(model.read("items"), "items", "filter", [a => a]).map(b => b)',
        )
    })

    test('optional chaining is preserved through the lowered method call', () => {
        // dropping `?.` made `model.read("modal").close()` throw when the read was undefined
        expect(lower('model.modal?.close()')).toContain('model.read("modal")?.close()')
        // an optional call token survives too
        expect(lower('model.modal.close?.()')).toContain('model.read("modal").close?.()')
        // an inner `?.` folds into the path (read traverses safely), the trailing one stays
        expect(lower('model.modal?.items?.map(f)')).toContain('model.read("modal/items")?.map(f)')
    })

    test('delete becomes a remove patch', () => {
        expect(lower('delete model.byId[key]')).toContain(
            'model.remove("byId/" + $$escapeKey(key))',
        )
    })

    test('a read used as an index lowers too', () => {
        expect(lower('model.lines[model.cursor].sku')).toContain(
            'model.read("lines/" + $$escapeKey(model.read("cursor")) + "/sku")',
        )
    })

    test('non-doc identifiers are left untouched', () => {
        expect(lower('other.foo = 1')).toContain('other.foo = 1')
    })
})

/* Runs lowered source against a real document by binding `model` and the runtime helpers
   the lowering emits — `escapeKey` for dynamic segments, `readCall` for guarded method
   calls — exactly the names the real module imports. */
function run(document: Doc, body: string): unknown {
    const lowered = lowerDocAccess(body, 'model')
    return new Function('model', 'escapeKey', 'readCall', lowered)(document, escapeKey, readCall)
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

    test('a method call runs against the read value', () => {
        const d = doc({ draft: '  hi  ', tags: ['a', 'b'] })
        expect(run(d, 'return model.draft.trim()')).toBe('hi')
        expect(run(d, 'return model.tags.join("-")')).toBe('a-b')
    })

    test('a non-optional call on an absent read throws naming the path and member', () => {
        // the screenshot bug: `model.read("modal").close()` threw the engine's opaque
        // `undefined is not an object`; the guard names the authored scope value instead.
        const d = doc({})
        expect(() => run(d, 'return model.modal.close()')).toThrow(
            'abide: cannot call .close() — scope value "modal" is undefined',
        )
    })

    test('an optional call on an undefined read short-circuits instead of throwing', () => {
        // the bug: `modal?.close()` lost its `?.` and threw at mount when `modal` was undefined
        const d = doc({})
        expect(run(d, 'return model.modal?.close()')).toBeUndefined()
        d.replace('modal', { close: () => 'closed' })
        expect(run(d, 'return model.modal?.close()')).toBe('closed')
    })

    test('a key containing / round-trips — read and remove address the whole key', () => {
        // The bug: a composite key (a date / URL id) was mis-split on the `/`-joined path.
        const d = doc({ byId: { 'a/b': 1, plain: 2 } })
        // literal key — escaped at compile time
        expect(run(d, 'return model.byId["a/b"]')).toBe(1)
        // dynamic key — escaped at runtime via escapeKey()
        expect(run(d, 'const k = "a/b"; return model.byId[k]')).toBe(1)
        run(d, 'const k = "a/b"; delete model.byId[k]')
        expect(d.read<Record<string, number>>('byId')).toEqual({ plain: 2 })
    })
})
