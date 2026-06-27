import { describe, expect, test } from 'bun:test'
import { renameSignalRefs } from '../src/lib/ui/compile/renameSignalRefs.ts'

/* `renameSignalRefs` rewrites value-position reads of a signal binding into the
   document form (`count` → `model.count`). Every identifier that is NOT a value
   read — a binding name, a property/label/specifier name — must be left untouched.
   These cover the positions a denylist historically missed: a forgotten position
   silently corrupted the output. The pass classifies by position, so an
   unrecognised position is a no-op (left as written), never a rewrite. */
describe('renameSignalRefs — only value-position reads rewrite', () => {
    const state = new Set(['count'])
    const none = new Set<string>()

    test('a genuine value read rewrites to the doc form', () => {
        const out = renameSignalRefs('console.log(count)', state, none)
        expect(out).toContain('model.count')
    })

    test('a destructure source key sharing the name is left untouched', () => {
        const out = renameSignalRefs('const { count: renamed } = obj', state, none)
        expect(out).toContain('count: renamed')
        expect(out).not.toContain('model.count')
    })

    test('a statement label sharing the name is left untouched', () => {
        const out = renameSignalRefs('count: for (const x of xs) { break count }', state, none)
        expect(out).not.toContain('model.count')
        expect(out).toMatch(/count:/)
        expect(out).toContain('break count')
    })

    test('a class method name sharing the name is left untouched', () => {
        const out = renameSignalRefs('class C { count() { return 1 } }', state, none)
        expect(out).not.toContain('model.count')
        expect(out).toMatch(/count\(\)/)
    })

    test('an aliased import whose original name collides is left untouched', () => {
        const out = renameSignalRefs("import { count as c } from 'm'\nlog(count)", state, none)
        expect(out).toContain("import { count as c } from 'm'")
        // the body read still rewrites
        expect(out).toContain('model.count')
    })
})

/* The reserved slot reader `children` rewrites through the same scope-aware machinery
   as a signal: a bare read becomes `$props?.$children`, but a nearer lexical binding
   (a param, a local) re-binds it and is left untouched — so a `{#snippet row(children)}`
   arg or a script callback param named `children` reads its own value, not the slot. */
describe('renameSignalRefs — children slot reader is lexically scoped', () => {
    const none = new Set<string>()

    test('a bare read rewrites to the slot reader', () => {
        const out = renameSignalRefs('if (children) render()', none, none)
        expect(out).toContain('$props?.$children')
    })

    test('a callback param shadowing the name reads the local', () => {
        const out = renameSignalRefs('list.map((children) => children.length)', none, none)
        expect(out).not.toContain('$props?.$children')
        expect(out).toMatch(/\(children\)\s*=>\s*children\.length/)
    })

    test('a property access is left untouched', () => {
        const out = renameSignalRefs('log(node.children)', none, none)
        expect(out).toContain('node.children')
        expect(out).not.toContain('$props?.$children')
    })
})
