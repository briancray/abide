import { describe, expect, test } from 'bun:test'
import { signalRefsTransformer } from '../src/lib/ui/compile/renameSignalRefs.ts'
import { transformSource } from './support/transformSource.ts'

/* `signalRefsTransformer` rewrites value-position reads of a signal binding into the
   document form (`count` → `model.count`). Every identifier that is NOT a value
   read — a binding name, a property/label/specifier name — must be left untouched.
   These cover the positions a denylist historically missed: a forgotten position
   silently corrupted the output. The pass classifies by position, so an
   unrecognised position is a no-op (left as written), never a rewrite. */
describe('signalRefsTransformer — only value-position reads rewrite', () => {
    const state = new Set(['count'])
    const none = new Set<string>()

    test('a genuine value read rewrites to the doc form', () => {
        const out = transformSource('console.log(count)', signalRefsTransformer(state, none))
        expect(out).toContain('model.count')
    })

    test('a destructure source key sharing the name is left untouched', () => {
        const out = transformSource(
            'const { count: renamed } = obj',
            signalRefsTransformer(state, none),
        )
        expect(out).toContain('count: renamed')
        expect(out).not.toContain('model.count')
    })

    test('a statement label sharing the name is left untouched', () => {
        const out = transformSource(
            'count: for (const x of xs) { break count }',
            signalRefsTransformer(state, none),
        )
        expect(out).not.toContain('model.count')
        expect(out).toMatch(/count:/)
        expect(out).toContain('break count')
    })

    test('a class method name sharing the name is left untouched', () => {
        const out = transformSource(
            'class C { count() { return 1 } }',
            signalRefsTransformer(state, none),
        )
        expect(out).not.toContain('model.count')
        expect(out).toMatch(/count\(\)/)
    })

    test('an aliased import whose original name collides is left untouched', () => {
        const out = transformSource(
            "import { count as c } from 'm'\nlog(count)",
            signalRefsTransformer(state, none),
        )
        expect(out).toContain("import { count as c } from 'm'")
        // the body read still rewrites
        expect(out).toContain('model.count')
    })
})

/* `children` is now an ordinary destructured prop, not a reserved ambient reader —
   it only rewrites when present in `derivedNames` (a destructured prop), exactly
   like any other derived name, through the same scope-aware machinery as a signal:
   a nearer lexical binding (a param, a local) re-binds it and is left untouched, so
   a `{#snippet row(children)}` arg or a script callback param named `children`
   reads its own value, not the prop. */
describe('signalRefsTransformer — children is an ordinary destructured prop', () => {
    const none = new Set<string>()
    const childrenDerived = new Set(['children'])

    test('a bare read with no matching prop is left untouched', () => {
        const out = transformSource('if (children) render()', signalRefsTransformer(none, none))
        expect(out).toContain('if (children)')
        expect(out).not.toContain('$children')
    })

    test('children is no longer a reserved ambient reader', () => {
        // With `children` in derivedNames (a destructured prop), it lowers to the computed read.
        const out = transformSource('children()', signalRefsTransformer(none, childrenDerived))
        expect(out).toContain('children.value()')
        expect(out).not.toContain('$children')
    })

    test('a callback param shadowing the name reads the local, not the prop', () => {
        const out = transformSource(
            'list.map((children) => children.length)',
            signalRefsTransformer(none, childrenDerived),
        )
        expect(out).not.toContain('.value')
        expect(out).toMatch(/\(children\)\s*=>\s*children\.length/)
    })

    test('a property access is left untouched', () => {
        const out = transformSource('log(node.children)', signalRefsTransformer(none, none))
        expect(out).toContain('node.children')
        expect(out).not.toContain('$children')
    })
})
