import { describe, expect, test } from 'bun:test'
import { history } from '../src/lib/ui/history.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'

describe('history — undo/redo over the patch bus', () => {
    test('scalar replace: steps back and forward through the journal', () => {
        const model = doc({ count: 0 })
        const past = history(model)

        model.replace('count', 1)
        model.replace('count', 2)
        expect(model.read<number>('count')).toBe(2)
        expect(past.canUndo()).toBe(true)
        expect(past.canRedo()).toBe(false)

        past.undo()
        expect(model.read<number>('count')).toBe(1)
        past.undo()
        expect(model.read<number>('count')).toBe(0)
        expect(past.canUndo()).toBe(false)
        expect(past.canRedo()).toBe(true)

        past.redo()
        expect(model.read<number>('count')).toBe(1)
        past.redo()
        expect(model.read<number>('count')).toBe(2)
        expect(past.canRedo()).toBe(false)
        past.dispose()
    })

    test('replace that creates a key inverts to removing it', () => {
        const model = doc({})
        const past = history(model)

        model.replace('x', 5)
        expect(model.read<number>('x')).toBe(5)
        past.undo()
        expect('x' in (model.snapshot() as object)).toBe(false)
        past.redo()
        expect(model.read<number>('x')).toBe(5)
        past.dispose()
    })

    test('array append (`-`) resolves to the concrete index it took', () => {
        const model = doc({ items: [] })
        const past = history(model)

        model.add('items/-', 'a')
        model.add('items/-', 'b')
        expect(model.snapshot()).toEqual({ items: ['a', 'b'] })

        past.undo()
        expect(model.snapshot()).toEqual({ items: ['a'] })
        past.undo()
        expect(model.snapshot()).toEqual({ items: [] })

        past.redo()
        expect(model.snapshot()).toEqual({ items: ['a'] })
        past.redo()
        expect(model.snapshot()).toEqual({ items: ['a', 'b'] })
        past.dispose()
    })

    test('array remove inverts to re-adding the value at its index', () => {
        const model = doc({ items: ['a', 'b', 'c'] })
        const past = history(model)

        model.remove('items/1')
        expect(model.snapshot()).toEqual({ items: ['a', 'c'] })
        past.undo()
        expect(model.snapshot()).toEqual({ items: ['a', 'b', 'c'] })
        past.dispose()
    })

    test('transaction groups many patches into one reversible step', () => {
        const model = doc({ a: 0, b: 0 })
        const past = history(model)

        past.transaction(() => {
            model.replace('a', 1)
            model.replace('b', 2)
        })
        expect(model.snapshot()).toEqual({ a: 1, b: 2 })

        past.undo()
        expect(model.snapshot()).toEqual({ a: 0, b: 0 }) // one undo reverses both
        past.redo()
        expect(model.snapshot()).toEqual({ a: 1, b: 2 }) // one redo reapplies both
        past.dispose()
    })

    test('a fresh edit after undo clears the redo stack', () => {
        const model = doc({ count: 0 })
        const past = history(model)

        model.replace('count', 1)
        past.undo()
        expect(past.canRedo()).toBe(true)
        model.replace('count', 9)
        expect(past.canRedo()).toBe(false)
        past.dispose()
    })

    test('limit caps the journal depth, dropping the oldest entry', () => {
        const model = doc({ count: 0 })
        const past = history(model, { limit: 2 })

        model.replace('count', 1)
        model.replace('count', 2)
        model.replace('count', 3)
        // only the last two steps are retained: 3→2→1, then nothing
        past.undo()
        expect(model.read<number>('count')).toBe(2)
        past.undo()
        expect(model.read<number>('count')).toBe(1)
        past.undo() // oldest (1←0) was evicted; no-op
        expect(model.read<number>('count')).toBe(1)
        expect(past.canUndo()).toBe(false)
        past.dispose()
    })

    test('a no-op patch (removing an absent key) is not journalled', () => {
        const model = doc({})
        const past = history(model)

        model.remove('nope')
        expect(past.canUndo()).toBe(false)
        past.dispose()
    })

    test('dispose detaches: later edits are not recorded', () => {
        const model = doc({ count: 0 })
        const past = history(model)

        model.replace('count', 1)
        past.dispose()
        model.replace('count', 2)
        // the journal was dropped on dispose, and the post-dispose edit is unseen
        expect(past.canUndo()).toBe(false)
    })
})
