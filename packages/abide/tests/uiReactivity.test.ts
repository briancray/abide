import { describe, expect, test } from 'bun:test'
import { createSubscriber } from '../src/lib/shared/createSubscriber.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { state } from '../src/lib/ui/state.ts'

describe('reactive cells', () => {
    test('effect reruns on state change and not on equal write', () => {
        const count = state(0)
        let runs = 0
        const dispose = effect(() => {
            count.value
            runs += 1
        })
        expect(runs).toBe(1)
        count.value = 1
        expect(runs).toBe(2)
        count.value = 1 // Object.is-equal → no wake
        expect(runs).toBe(2)
        dispose()
        count.value = 2
        expect(runs).toBe(2) // disposed → detached
    })

    test('derived recomputes lazily and only when a dependency changed', () => {
        const a = state(2)
        const b = state(3)
        let computes = 0
        const sum = derived(() => {
            computes += 1
            return a.value + b.value
        })
        expect(computes).toBe(0) // lazy: not computed until read
        expect(sum.value).toBe(5)
        expect(computes).toBe(1)
        expect(sum.value).toBe(5) // cached
        expect(computes).toBe(1)
        a.value = 10
        expect(sum.value).toBe(13)
        expect(computes).toBe(2)
    })

    test('dynamic dependencies: a branch not taken is not subscribed', () => {
        const useA = state(true)
        const a = state('a')
        const b = state('b')
        let runs = 0
        effect(() => {
            useA.value ? a.value : b.value
            runs += 1
        })
        expect(runs).toBe(1)
        b.value = 'b2' // not read on this branch → no wake
        expect(runs).toBe(1)
        a.value = 'a2'
        expect(runs).toBe(2)
    })
})

describe('reactive document', () => {
    test('a leaf patch wakes only readers of that path', () => {
        const d = doc({ items: [{ n: 0 }, { n: 0 }, { n: 0 }] })
        const runs = [0, 0, 0]
        for (let index = 0; index < 3; index += 1) {
            effect(() => {
                d.read(`items/${index}/n`)
                runs[index] += 1
            })
        }
        expect(runs).toEqual([1, 1, 1])
        d.replace('items/1/n', 42)
        // Only the reader of items/1/n re-ran — path-addressed dispatch.
        expect(runs).toEqual([1, 2, 1])
        expect(d.read<number>('items/1/n')).toBe(42)
    })

    test('shape-only: a deep field replace leaves a container reader asleep', () => {
        const d = doc({ user: { name: 'ada', age: 36 } })
        let userRuns = 0
        let nameRuns = 0
        effect(() => {
            d.read('user')
            userRuns += 1
        })
        effect(() => {
            d.read('user/name')
            nameRuns += 1
        })
        d.replace('user/age', 37)
        // Reading 'user' subscribes to its shape; a deep field change wakes only
        // the field's own reader, never the container above it.
        expect(userRuns).toBe(1)
        expect(nameRuns).toBe(1)
        d.replace('user/name', 'grace')
        expect(nameRuns).toBe(2)
        expect(userRuns).toBe(1)
    })

    test('shape change (add/remove) wakes the container reader', () => {
        const d = doc({ list: [{ n: 1 }] })
        let listRuns = 0
        effect(() => {
            d.read('list')
            listRuns += 1
        })
        d.replace('list/0/n', 2) // deep field → shape unchanged → asleep
        expect(listRuns).toBe(1)
        d.add('list/-', { n: 9 }) // structural → shape changed
        expect(listRuns).toBe(2)
        d.remove('list/0')
        expect(listRuns).toBe(3)
    })

    test('a patch mutates in place — no cloning, sibling identity preserved', () => {
        const d = doc({ a: { keep: 1 }, b: { change: 1 } })
        const before = d.snapshot() as { a: object; b: { change: number } }
        const aRef = before.a
        const bRef = before.b
        d.replace('b/change', 2)
        const after = d.snapshot() as { a: object; b: { change: number } }
        expect(after).toBe(before) // same live root — the O(width) copy is gone
        expect(after.a).toBe(aRef) // untouched sibling, same ref
        expect(after.b).toBe(bRef) // mutated in place, same ref
        expect(after.b.change).toBe(2)
    })

    test('cell() is a stable accessor: get reads, set wakes its readers', () => {
        const d = doc({ items: [{ n: 0 }, { n: 0 }] })
        const first = d.cell<number>('items/0/n')
        let runs = 0
        effect(() => {
            first.get()
            runs += 1
        })
        expect(runs).toBe(1)
        first.set(9)
        expect(first.get()).toBe(9)
        expect(d.read<number>('items/0/n')).toBe(9) // path read sees the same value
        expect(runs).toBe(2)
        first.set(9) // equal → no wake
        expect(runs).toBe(2)
    })

    test('add and remove patches reach list readers', () => {
        const d = doc({ list: ['a', 'b'] })
        let runs = 0
        effect(() => {
            d.read('list')
            runs += 1
        })
        d.add('list/-', 'c')
        expect(d.read<string[]>('list')).toEqual(['a', 'b', 'c'])
        d.remove('list/0')
        expect(d.read<string[]>('list')).toEqual(['b', 'c'])
        expect(runs).toBe(3)
    })

    test('one apply flushes dependent effects exactly once (batched)', () => {
        const d = doc({ x: 1, y: 1 })
        let runs = 0
        effect(() => {
            d.read('x')
            d.read('y')
            runs += 1
        })
        expect(runs).toBe(1)
        d.replace('x', 2)
        expect(runs).toBe(2)
    })

    /*
    Regression: a derived over a createSubscriber resource (e.g. tail()), read by
    an effect, must wake the effect exactly once per update. A single update used
    to loop forever — trigger walked the live observer Set while the flush it
    fired re-ran the derived, whose runNode deletes-then-re-adds itself to that
    same Set, re-yielding it to the in-progress for…of without end.
    */
    test('a derived over a createSubscriber wakes its effect once per update, no loop', () => {
        let value: unknown = undefined
        let fire: () => void = () => {}
        const tap = createSubscriber((update) => {
            fire = update
            return () => {}
        })
        const latest = derived(() => {
            tap()
            return value
        })
        let runs = 0
        const dispose = effect(() => {
            latest.value
            runs += 1
        })
        expect(runs).toBe(1)
        value = { msg: 1 }
        fire()
        expect(runs).toBe(2)
        expect(latest.value).toEqual({ msg: 1 })
        value = { msg: 2 }
        fire()
        expect(runs).toBe(3)
        dispose()
    })
})
