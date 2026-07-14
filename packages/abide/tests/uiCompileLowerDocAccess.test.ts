import { describe, expect, test } from 'bun:test'
import { docAccessTransformer } from '../src/lib/ui/compile/lowerDocAccess.ts'
import { mutateDocContainer } from '../src/lib/ui/dom/mutateDocContainer.ts'
import { readCall } from '../src/lib/ui/dom/readCall.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { escapeKey } from '../src/lib/ui/runtime/escapeKey.ts'
import type { Doc } from '../src/lib/ui/runtime/types/Doc.ts'
import { transformSource } from './support/transformSource.ts'

/* Normalises printer whitespace so substring assertions are stable. */
function lower(code: string): string {
    return transformSource(code, docAccessTransformer('model')).replace(/\s+/g, ' ').trim()
}

describe('lowerDocAccess — emitted shape', () => {
    test('assignment becomes a replace patch', () => {
        expect(lower("model.note = 'x'")).toContain('model.replace("note", \'x\')')
    })

    test('increment/decrement on a doc path becomes a replace patch', () => {
        /* `n++` would otherwise leave `model.read("n")++` — invalid, a call result is not
           an lvalue. Prefix evaluates to the new value (the replace's return); postfix
           evaluates to the PREVIOUS value, so it is corrected back by the opposite step. */
        expect(lower('++model.n')).toContain('model.replace("n", model.read("n") + 1)')
        expect(lower('model.n++')).toContain('model.replace("n", model.read("n") + 1) - 1')
        expect(lower('model.n--')).toContain('model.replace("n", model.read("n") - 1) + 1')
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

    test('logical assignment short-circuits — the write fires only when the guard passes', () => {
        // `x ??= v` is `x ?? (x = v)`: the replace sits on the RIGHT of the guard, so a
        // non-nullish/truthy/falsy read never writes (no needless patch or cell reseed).
        expect(lower("model.text ||= 'x'")).toContain(
            'model.read("text") || model.replace("text", \'x\')',
        )
        expect(lower('model.count ??= 0')).toContain(
            'model.read("count") ?? model.replace("count", 0)',
        )
        expect(lower('model.flag &&= false')).toContain(
            'model.read("flag") && model.replace("flag", false)',
        )
    })

    test('array push becomes an add patch at the - slot', () => {
        expect(lower('model.lines.push(v)')).toContain('model.add("lines/-", v)')
    })

    test('in-place-mutating array methods route through mutateDocContainer, not readCall', () => {
        // the bug: only `push` patched; `.splice`/`.pop`/`.sort`/… fell into the generic
        // readCall branch and mutated the live tree by reference, emitting no patch.
        expect(lower('model.todos.splice(i, 1)')).toContain(
            '$$mutateDocContainer(model, "todos", "splice", [i, 1])',
        )
        expect(lower('model.todos.pop()')).toContain(
            '$$mutateDocContainer(model, "todos", "pop", [])',
        )
        expect(lower('model.todos.sort()')).toContain(
            '$$mutateDocContainer(model, "todos", "sort", [])',
        )
        // non-mutating methods still read + guard on the value
        expect(lower('model.todos.map(f)')).toContain(
            '$$readCall(model.read("todos"), "todos", "map", [f])',
        )
        // optional-chained mutation keeps bare-call skip-if-absent semantics
        expect(lower('model.todos?.splice(0, 1)')).toContain('model.read("todos")?.splice(0, 1)')
    })

    test('in-place-mutating Set/Map methods route through mutateDocContainer too', () => {
        // the doc codec serializes Map/Set, so a doc-held collection is legit — but `.add`/
        // `.set`/`.delete`/`.clear` mutated the live collection by reference, emitting no patch.
        expect(lower('model.tags.add(x)')).toContain(
            '$$mutateDocContainer(model, "tags", "add", [x])',
        )
        expect(lower('model.tags.delete(x)')).toContain(
            '$$mutateDocContainer(model, "tags", "delete", [x])',
        )
        expect(lower('model.byId.set(k, v)')).toContain(
            '$$mutateDocContainer(model, "byId", "set", [k, v])',
        )
        expect(lower('model.byId.clear()')).toContain(
            '$$mutateDocContainer(model, "byId", "clear", [])',
        )
        // non-mutating collection reads still guard through readCall
        expect(lower('model.tags.has(x)')).toContain(
            '$$readCall(model.read("tags"), "tags", "has", [x])',
        )
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
    const lowered = transformSource(body, docAccessTransformer('model'))
    return new Function('model', 'escapeKey', 'readCall', 'mutateDocContainer', lowered)(
        document,
        escapeKey,
        readCall,
        (d: Doc, path: string, member: string, args: unknown[]) =>
            mutateDocContainer(d, path, member, args),
    )
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

    test('postfix ++/-- evaluates to the previous value, prefix to the new one', () => {
        // JS semantics through a doc slot: `n++` returns the pre-step value, `++n` the
        // stepped one — the write still lands in both cases.
        const d = doc({ n: 5 })
        expect(run(d, 'return model.n++')).toBe(5)
        expect(d.read<number>('n')).toBe(6)
        expect(run(d, 'return ++model.n')).toBe(7)
        expect(d.read<number>('n')).toBe(7)
        expect(run(d, 'return model.n--')).toBe(7)
        expect(d.read<number>('n')).toBe(6)
    })

    test('a logical-assignment guard that fails fires no write', () => {
        // `text ??= v` with a non-nullish `text` must NOT patch — a needless replace would
        // wake readers and reseed. A derived reader proves it stayed asleep.
        const d = doc({ text: 'set' })
        let recomputes = 0
        const view = d.derive('view', () => {
            recomputes++
            return d.read<string>('text')
        })
        expect(view()).toBe('set') // prime the reader
        expect(run(d, "return model.text ??= 'fallback'")).toBe('set') // guard fails → no write
        expect(view()).toBe('set')
        expect(recomputes).toBe(1) // never recomputed ⇒ no write fired
        run(d, 'model.text &&= null') // guard passes (truthy) → writes
        expect(d.read<string | null>('text')).toBeNull()
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

    test('a mutating array method wakes readers and updates the tree', () => {
        // the critical bug: `.splice`/`.pop`/… mutated the live array by reference and
        // emitted no patch, so readers never woke. A derived reader over the array only
        // recomputes if the mutation woke its dependency — `d.read` alone can't tell an
        // in-place mutation (the bug) from a clone-apply (the fix), since both leave the
        // same value behind.
        const d = doc({ todos: ['a', 'b', 'c'] })
        const count = d.derive('count', () => d.read<string[]>('todos').length)
        expect(count()).toBe(3) // prime the reader
        const removed = run(d, 'return model.todos.splice(1, 1)')
        expect(removed).toEqual(['b']) // native return value preserved
        expect(d.read<string[]>('todos')).toEqual(['a', 'c']) // tree advanced
        expect(count()).toBe(2) // the reader recomputed ⇒ the mutation woke it
    })

    test('pop/shift/unshift/sort/reverse all patch through the document', () => {
        const d = doc({ nums: [3, 1, 2] })
        expect(run(d, 'return model.nums.pop()')).toBe(2)
        expect(d.read<number[]>('nums')).toEqual([3, 1])
        run(d, 'model.nums.unshift(9)')
        expect(d.read<number[]>('nums')).toEqual([9, 3, 1])
        expect(run(d, 'return model.nums.shift()')).toBe(9)
        expect(d.read<number[]>('nums')).toEqual([3, 1])
        run(d, 'model.nums.sort()')
        expect(d.read<number[]>('nums')).toEqual([1, 3])
        run(d, 'model.nums.reverse()')
        expect(d.read<number[]>('nums')).toEqual([3, 1])
    })

    test('a mutating Set method wakes readers and updates the tree', () => {
        // a doc-held Set: `.add`/`.delete`/`.clear` must clone-apply-replace so readers wake,
        // exactly like the array path — a bare in-place call mutated by reference, no re-render.
        const d = doc({ tags: new Set(['a', 'b']) })
        const size = d.derive('size', () => d.read<Set<string>>('tags').size)
        expect(size()).toBe(2)
        run(d, "model.tags.add('c')")
        expect([...d.read<Set<string>>('tags')]).toEqual(['a', 'b', 'c'])
        expect(size()).toBe(3) // add woke the reader
        const deleted = run(d, "return model.tags.delete('a')")
        expect(deleted).toBe(true) // native return value preserved
        expect([...d.read<Set<string>>('tags')]).toEqual(['b', 'c'])
        expect(size()).toBe(2) // delete woke the reader
    })

    test('a mutating Map method emits a patch and updates the tree', () => {
        const d = doc({ byId: new Map<string, number>([['a', 1]]) })
        run(d, "model.byId.set('b', 2)")
        expect(d.read<Map<string, number>>('byId').get('b')).toBe(2)
        run(d, "model.byId.delete('a')")
        expect(d.read<Map<string, number>>('byId').has('a')).toBe(false)
        run(d, 'model.byId.clear()')
        expect(d.read<Map<string, number>>('byId').size).toBe(0)
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
