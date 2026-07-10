import { afterEach, describe, expect, test } from 'bun:test'
import { createScope } from '../src/lib/ui/createScope.ts'
import { CURRENT_SCOPE } from '../src/lib/ui/runtime/CURRENT_SCOPE.ts'
import { scope } from '../src/lib/ui/scope.ts'

afterEach(() => {
    CURRENT_SCOPE.current = undefined
})

describe('scope — the lexical data seam', () => {
    test('a scope owns reactive data: stored slots and computed slots', () => {
        const s = createScope({ count: 2 })
        const doubled = s.derive('doubled', () => s.read<number>('count') * 2)

        expect(s.read<number>('count')).toBe(2)
        expect(doubled()).toBe(4)
        s.replace('count', 5)
        expect(doubled()).toBe(10)
        expect(s.snapshot()).toEqual({ count: 5 }) // computed not stored
    })

    test('scopes nest: a child links to its parent', () => {
        const root = createScope({ app: true })
        const child = createScope({ local: 1 }, root)
        const grandchild = createScope({}, child)

        expect(child.parent).toBe(root)
        expect(grandchild.parent).toBe(child)
        expect(child.read<number>('local')).toBe(1)
    })

    test('dispose runs the scope’s registered teardowns', () => {
        const s = createScope({})
        let torn = false
        s.own(() => {
            torn = true
        })

        s.dispose()
        expect(torn).toBe(true) // the registered teardown ran
    })

    test('scope() resolves the ambient current scope', () => {
        const root = createScope({})
        const child = createScope({}, root)
        CURRENT_SCOPE.current = child

        expect(scope()).toBe(child) // current
        expect(child.parent).toBe(root) // parent reached via the handle
    })

    test('share/shared passes context down the tree to the closest ancestor', () => {
        const root = createScope({})
        const child = createScope({}, root)
        const grandchild = createScope({}, child)

        root.share('theme', 'dark')
        expect(grandchild.shared<string>('theme')).toBe('dark') // walks up to root
        expect(root.shared<string>('theme')).toBe('dark') // self reads its own share

        // a deeper scope shadows an ancestor for its own subtree
        child.share('theme', 'light')
        expect(grandchild.shared<string>('theme')).toBe('light') // closest wins
        expect(root.shared<string>('theme')).toBe('dark') // unaffected above the override
    })

    test('shared returns undefined when no ancestor provides the key', () => {
        const child = createScope({}, createScope({}))
        expect(child.shared('missing')).toBeUndefined()
    })

    test('a shared undefined shadows an ancestor (has check, not truthiness)', () => {
        const root = createScope({})
        const child = createScope({}, root)
        const grandchild = createScope({}, child)

        root.share('flag', 'on')
        child.share('flag', undefined) // explicitly provided as undefined
        expect(grandchild.shared('flag')).toBeUndefined() // stops at child, not root
    })

    test('reactive context: share a scope, descendants read live updates', () => {
        const root = createScope({ count: 0 })
        const child = createScope({}, root)
        root.share('app', root) // share the scope; its doc is reactive

        const app = child.shared<typeof root>('app')
        expect(app?.read<number>('count')).toBe(0)
        root.replace('count', 3)
        expect(app?.read<number>('count')).toBe(3) // reactivity rides the shared scope's doc, not share itself
    })

    test('scope() outside any scope mints a detached root once', () => {
        const a = scope()
        const b = scope()
        expect(a).toBe(b) // same root reused, not re-created
        expect(a.parent).toBeUndefined()
    })
})
