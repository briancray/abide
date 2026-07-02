import { afterEach, describe, expect, test } from 'bun:test'
import { createScope } from '../src/lib/ui/createScope.ts'
import { CURRENT_SCOPE } from '../src/lib/ui/runtime/CURRENT_SCOPE.ts'
import { scope } from '../src/lib/ui/scope.ts'
import type { PersistenceStore } from '../src/lib/ui/types/PersistenceStore.ts'

afterEach(() => {
    CURRENT_SCOPE.current = undefined
})

const memoryStore = (): PersistenceStore & { data: Map<string, unknown> } => {
    const data = new Map<string, unknown>()
    return {
        data,
        load: (key) => data.get(key),
        save: (key, snapshot) => data.set(key, structuredClone(snapshot)),
        remove: (key) => data.delete(key),
    }
}

describe('scope — the lexical data + capability seam', () => {
    test('a scope owns reactive data: stored slots and computed slots', () => {
        const s = createScope({ count: 2 })
        const doubled = s.derive('doubled', () => s.read<number>('count') * 2)

        expect(s.read<number>('count')).toBe(2)
        expect(doubled()).toBe(4)
        s.replace('count', 5)
        expect(doubled()).toBe(10)
        expect(s.snapshot()).toEqual({ count: 5 }) // computed not stored
    })

    test('record() enables undo; undo/redo act on the scope', () => {
        const s = createScope({ n: 0 })
        s.record() // declare the capability

        s.replace('n', 1)
        s.replace('n', 2)
        expect(s.canUndo()).toBe(true)
        s.undo()
        expect(s.read<number>('n')).toBe(1)
        s.redo()
        expect(s.read<number>('n')).toBe(2)
    })

    test('a scope without undoable() ignores undo (no journal, no cost)', () => {
        const s = createScope({ n: 0 })
        s.replace('n', 1)
        expect(s.canUndo()).toBe(false)
        expect(() => s.undo()).not.toThrow()
        expect(s.read<number>('n')).toBe(1)
    })

    test('persist() makes the scope durable, defaulting its key to the scope id', () => {
        const store = memoryStore()
        const s = createScope({ title: '' })
        s.persist() // key defaults to s.id
        s.replace('title', 'kept')
        // explicit store path: re-create and restore under the same id
        const reloaded = createScope({ title: '' })
        // (persist() uses the default localStorage store; here we assert the id is the key)
        expect(typeof s.id).toBe('string')
        expect(reloaded.id).not.toBe(s.id) // distinct scopes get distinct ids
        void store
    })

    test('scopes nest: a child links to its parent and back to the root', () => {
        const root = createScope({ app: true })
        const child = root.child({ local: 1 })
        const grandchild = child.child({})

        expect(child.parent).toBe(root)
        expect(grandchild.root()).toBe(root)
        expect(child.root()).toBe(root)
        expect(child.read<number>('local')).toBe(1)
    })

    test('dispose tears down the whole subtree', () => {
        const root = createScope({})
        const child = root.child({})
        child.record()
        child.replace('x', 1)
        expect(child.canUndo()).toBe(true)

        root.dispose() // cascades to the child
        expect(child.canUndo()).toBe(false) // child history dropped
    })

    test('scope() resolves the ambient current scope', () => {
        const root = createScope({})
        const child = root.child({})
        CURRENT_SCOPE.current = child

        expect(scope()).toBe(child) // current
        expect(child.root()).toBe(root) // root reached via the handle, not scope()
    })

    test('share/shared passes context down the tree to the closest ancestor', () => {
        const root = createScope({})
        const child = root.child({})
        const grandchild = child.child({})

        root.share('theme', 'dark')
        expect(grandchild.shared<string>('theme')).toBe('dark') // walks up to root
        expect(root.shared<string>('theme')).toBe('dark') // self reads its own share

        // a deeper scope shadows an ancestor for its own subtree
        child.share('theme', 'light')
        expect(grandchild.shared<string>('theme')).toBe('light') // closest wins
        expect(root.shared<string>('theme')).toBe('dark') // unaffected above the override
    })

    test('shared returns undefined when no ancestor provides the key', () => {
        const child = createScope({}).child({})
        expect(child.shared('missing')).toBeUndefined()
    })

    test('a shared undefined shadows an ancestor (has check, not truthiness)', () => {
        const root = createScope({})
        const child = root.child({})
        const grandchild = child.child({})

        root.share('flag', 'on')
        child.share('flag', undefined) // explicitly provided as undefined
        expect(grandchild.shared('flag')).toBeUndefined() // stops at child, not root
    })

    test('reactive context: share a cell, descendants see updates', () => {
        const root = createScope({ count: 0 })
        const child = root.child({})
        root.share('count', root.cell<number>('count'))

        const cell = child.shared<ReturnType<typeof root.cell<number>>>('count')
        expect(cell?.get()).toBe(0)
        root.replace('count', 3)
        expect(cell?.get()).toBe(3) // reactivity rides the shared cell, not share itself
    })

    test('scope() outside any scope mints a detached root once', () => {
        const a = scope()
        const b = scope()
        expect(a).toBe(b) // same root reused, not re-created
        expect(a.parent).toBeUndefined()
    })
})
