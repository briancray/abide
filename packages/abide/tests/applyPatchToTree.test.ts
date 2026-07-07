import { afterEach, describe, expect, test } from 'bun:test'
import { applyPatchToTree } from '../src/lib/ui/runtime/applyPatchToTree.ts'
import { createDoc } from '../src/lib/ui/runtime/createDoc.ts'

/* Splits a patch path the way createDoc does before calling applyPatchToTree. */
function apply(tree: unknown, patch: Parameters<typeof applyPatchToTree>[1]): unknown {
    const segments = patch.path === '' ? [] : patch.path.split('/')
    return applyPatchToTree(tree, patch, segments)
}

describe('applyPatchToTree — prototype-pollution defense', () => {
    afterEach(() => {
        // Guard against a leaked pollution failing unrelated suites.
        delete (Object.prototype as Record<string, unknown>).polluted
    })

    test('a __proto__ terminal segment writes an own key, not the prototype', () => {
        const tree: Record<string, unknown> = { a: {} }
        apply(tree, { op: 'replace', path: 'a/__proto__', value: { polluted: true } })
        // Object.prototype is untouched; a fresh object sees nothing.
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    test('a __proto__ intermediate segment cannot reach Object.prototype', () => {
        const tree: Record<string, unknown> = { a: {} }
        expect(() =>
            apply(tree, { op: 'add', path: 'a/__proto__/polluted', value: true }),
        ).toThrow()
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    test('a constructor/prototype chain cannot reach a shared prototype', () => {
        const tree: Record<string, unknown> = { a: {} }
        expect(() =>
            apply(tree, { op: 'replace', path: 'a/constructor/prototype/polluted', value: true }),
        ).toThrow()
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    test('a legit own key named constructor still traverses (own data, not the inherited one)', () => {
        const tree: Record<string, unknown> = { constructor: { nested: 1 } }
        apply(tree, { op: 'replace', path: 'constructor/nested', value: 2 })
        expect((tree.constructor as Record<string, unknown>).nested).toBe(2)
    })

    test('normal nested writes are unaffected', () => {
        const tree: Record<string, unknown> = { a: { b: [1, 2] } }
        apply(tree, { op: 'replace', path: 'a/b/0', value: 9 })
        apply(tree, { op: 'add', path: 'a/b/-', value: 3 })
        expect((tree.a as { b: number[] }).b).toEqual([9, 2, 3])
    })

    test('createDoc.apply (the sync() path) rejects a malicious peer patch', () => {
        const doc = createDoc({ a: {} })
        expect(() => doc.apply({ op: 'add', path: 'a/__proto__/polluted', value: true })).toThrow()
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })
})
