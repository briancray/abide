import { describe, expect, test } from 'bun:test'
import { createSubscriber } from '../src/lib/shared/createSubscriber.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { linked } from '../src/lib/ui/linked.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'

describe('reactive doc cell', () => {
    test('cell() does NOT auto-vivify ancestors until first write', () => {
        // the bug: hoistCells lifts `model.cell(path)` to mount scope, and cell() vivified
        // ancestors eagerly — fabricating structure for a path only written behind a
        // never-run branch/handler. Vivify must be lazy (on the first set).
        const d = doc({ settings: {} })
        const cell = d.cell<string>('settings/theme/color')
        // Creating the cell (and reading it) must not fabricate `settings.theme`.
        expect(d.snapshot()).toEqual({ settings: {} })
        expect(cell.get()).toBeUndefined()
        expect(d.snapshot()).toEqual({ settings: {} })
        // First write vivifies the ancestor and lands in the live tree.
        cell.set('red')
        expect(d.snapshot()).toEqual({ settings: { theme: { color: 'red' } } })
        expect(cell.get()).toBe('red')
    })
})

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

    test('computed recomputes lazily and only when a dependency changed', () => {
        const a = state(2)
        const b = state(3)
        let computes = 0
        const sum = computed(() => {
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

    test('a computed that recomputes to an equal value does NOT wake its effect (value memoisation)', () => {
        // distils the route case: params churn but the id-derived value is stable
        const params = state({ id: '1', rest: 'a' })
        const id = computed(() => params.value.id)
        let runs = 0
        const dispose = effect(() => {
            id.value
            runs += 1
        })
        expect(runs).toBe(1)
        params.value = { id: '1', rest: 'b' } // id unchanged → memoised
        expect(runs).toBe(1)
        params.value = { id: '2', rest: 'b' } // id changed → wakes
        expect(runs).toBe(2)
        dispose()
    })

    test('a throwing effect does not strand siblings queued behind it, and both recover', () => {
        // critical bug: one effect throwing mid-flush swapped away the pending batch, so
        // every effect queued behind it never ran AND could never be re-queued (its status
        // was left dirty, so mark()'s CLEAN→dirty gate ignored later writes forever).
        const trigger = state(0)
        let aRuns = 0
        let bRuns = 0
        let aThrows = false
        const disposeA = effect(() => {
            trigger.value
            aRuns += 1
            if (aThrows) {
                throw new Error('effect A boom')
            }
        })
        const disposeB = effect(() => {
            trigger.value
            bRuns += 1
        })
        expect(aRuns).toBe(1)
        expect(bRuns).toBe(1)

        // A (created first, queued first) throws; B must still run this pass.
        aThrows = true
        expect(() => {
            trigger.value = 1
        }).toThrow('effect A boom')
        expect(bRuns).toBe(2) // sibling not stranded

        // A recovers: a later write re-queues it (not permanently inert), and B keeps reacting.
        aThrows = false
        expect(() => {
            trigger.value = 2
        }).not.toThrow()
        expect(aRuns).toBe(3) // A ran again after having thrown once
        expect(bRuns).toBe(3)

        disposeA()
        disposeB()
    })

    test('memoisation stops at the first unchanged computed in a chain', () => {
        const n = state(2)
        const isEven = computed(() => n.value % 2 === 0)
        let runs = 0
        const dispose = effect(() => {
            isEven.value
            runs += 1
        })
        expect(runs).toBe(1)
        n.value = 4 // still even → isEven unchanged → no wake
        expect(runs).toBe(1)
        n.value = 5 // odd → isEven flips → wakes
        expect(runs).toBe(2)
        dispose()
    })

    test('an unchanged computed still does not wake a diamond reader (glitch-free)', () => {
        const n = state(1)
        const a = computed(() => n.value > 0) // stable across 1→2
        const b = computed(() => n.value > 0) // stable across 1→2
        let runs = 0
        const dispose = effect(() => {
            void (a.value && b.value)
            runs += 1
        })
        expect(runs).toBe(1)
        n.value = 2 // both a and b recompute to the same boolean
        expect(runs).toBe(1)
        n.value = -1 // both flip
        expect(runs).toBe(2)
        dispose()
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

describe('write-coercion and reactive seeds', () => {
    test('state transform coerces writes, not the construction initial', () => {
        const clamp = (n: number) => Math.max(1, Math.min(99, n))
        const qty = state(150, clamp)
        expect(qty.value).toBe(150) // initial taken verbatim
        qty.value = 1000
        expect(qty.value).toBe(99) // write clamped
        qty.value = -5
        expect(qty.value).toBe(1)
    })

    test('state transform can reject a write by returning previous', () => {
        const positive = (next: number, previous: number) => (next > 0 ? next : previous)
        const n = state(5, positive)
        let runs = 0
        effect(() => {
            n.value
            runs += 1
        })
        expect(runs).toBe(1)
        n.value = -1 // rejected → returns previous → Object.is no-op
        expect(n.value).toBe(5)
        expect(runs).toBe(1) // no wake
        n.value = 8
        expect(n.value).toBe(8)
        expect(runs).toBe(2)
    })

    test('linked reseeds from upstream, keeps local edits, and reclaims on change', () => {
        const upstream = state(10)
        const draft = linked(() => upstream.value)
        expect(draft.value).toBe(10) // seeded synchronously
        draft.value = 42 // local edit
        expect(draft.value).toBe(42)
        expect(upstream.value).toBe(10) // edit does not flow upstream
        upstream.value = 20 // upstream change reclaims the draft
        expect(draft.value).toBe(20)
    })

    test('linked transform gates reseeds and writes alike', () => {
        const clamp = (n: number) => Math.max(0, Math.min(100, n))
        const upstream = state(250)
        const draft = linked(() => upstream.value, clamp)
        expect(draft.value).toBe(100) // reseed coerced
        draft.value = -7
        expect(draft.value).toBe(0) // write coerced
        upstream.value = 500
        expect(draft.value).toBe(100) // reseed coerced again
    })

    test('linked wakes downstream readers on both edits and reseeds', () => {
        const upstream = state(1)
        const draft = linked(() => upstream.value)
        const seen: number[] = []
        effect(() => {
            seen.push(draft.value)
        })
        expect(seen).toEqual([1])
        draft.value = 2
        expect(seen).toEqual([1, 2])
        upstream.value = 9
        expect(seen).toEqual([1, 2, 9])
    })

    test('computed is read-only — it recomputes from upstream and has no setter', () => {
        const celsius = state(0)
        const fahrenheit = computed(() => (celsius.value * 9) / 5 + 32)
        expect(fahrenheit.value).toBe(32)
        /* A computed is purely a function of its sources — there is no write-through.
           Assigning a getter-only property throws in strict mode (ES modules are strict);
           a write to a computed is expressed at the binding (`bind:value={{ get, set }}`). */
        expect(() => {
            // @ts-expect-error — Computed.value is readonly
            fahrenheit.value = 212
        }).toThrow()
        celsius.value = 100
        expect(fahrenheit.value).toBe(212) // recomputes from upstream
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

    test('end-append wakes the length node and the new slot, leaves stable siblings asleep', () => {
        const d = doc({ list: [{ n: 1 }] })
        let lengthRuns = 0
        let firstRuns = 0
        let slotRuns = 0
        effect(() => {
            d.read('list/length')
            lengthRuns += 1
        })
        effect(() => {
            d.read('list/0/n')
            firstRuns += 1
        })
        /* Read a slot that doesn't exist yet — the append fills it, so its reader must wake. */
        effect(() => {
            d.read('list/1')
            slotRuns += 1
        })
        expect([lengthRuns, firstRuns, slotRuns]).toEqual([1, 1, 1])
        d.add('list/-', { n: 9 })
        expect(d.read<number>('list/length')).toBe(2)
        expect(lengthRuns).toBe(2) // length changed
        expect(slotRuns).toBe(2) // the previously-empty index is now filled
        expect(firstRuns).toBe(1) // an existing element's value is untouched → asleep
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
    Regression: a computed over a createSubscriber resource (e.g. tail()), read by
    an effect, must wake the effect exactly once per update. A single update used
    to loop forever — trigger walked the live observer Set while the flush it
    fired re-ran the computed, whose runNode deletes-then-re-adds itself to that
    same Set, re-yielding it to the in-progress for…of without end.
    */
    test('a computed over a createSubscriber wakes its effect once per update, no loop', () => {
        let value: unknown
        let fire: () => void = () => {}
        const tap = createSubscriber((update) => {
            fire = update
            return () => {}
        })
        const latest = computed(() => {
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

/* The structural descend reaches readers via the prefix index (a trie over minted
   paths' ancestor chains), not a scan of every live node. These pin its distinctive
   behaviours: descend through INTERMEDIATE paths that hold no node of their own,
   index-shift on a list remove, eviction of paths the mutation dropped, and re-mint
   of an evicted path the same effects keep observing. */
describe('structural descend via the prefix index', () => {
    test('a list remove shifts every index-bound reader and wakes it', () => {
        const d = doc({ order: ['a', 'b', 'c'] })
        const seen: string[][] = []
        const dispose = effect(() => {
            seen.push([d.read<string>('order/0'), d.read<string>('order/1')])
        })
        expect(seen.at(-1)).toEqual(['a', 'b'])
        d.remove('order/0') // shifts: 0←b, 1←c
        expect(seen.at(-1)).toEqual(['b', 'c'])
        expect(d.read<string | undefined>('order/2')).toBeUndefined()
        dispose()
    })

    test('descend reaches a deep reader through intermediate node-less paths', () => {
        /* Only `byId/<key>/n` is ever read, so `byId` and `byId/<key>` carry no node —
           they exist only as trie links. A structural change at the root must still
           wake the deep reader through those links. */
        const d = doc({ byId: { x: { n: 1 } } })
        let observed: number | undefined
        const dispose = effect(() => {
            observed = d.read<number>('byId/x/n')
        })
        expect(observed).toBe(1)
        d.replace('', { byId: { x: { n: 9 } }, extra: true }) // root structural replace
        expect(observed).toBe(9)
        dispose()
    })

    test('a dropped path is evicted and a returning path re-mints, still observed', () => {
        const d = doc({ items: ['a', 'b'] })
        let runs = 0
        let tail: string | undefined
        const dispose = effect(() => {
            runs += 1
            tail = d.read<string | undefined>('items/1')
        })
        expect(tail).toBe('b')
        const baseline = runs
        d.remove('items/1') // drops items/1 → reader woken to undefined, node evicted
        expect(tail).toBeUndefined()
        expect(runs).toBe(baseline + 1)
        d.add('items/-', 'c') // items/1 returns → re-mint, reader picks it up
        expect(tail).toBe('c')
        dispose()
    })

    test('removing a container wakes and evicts its descendants', () => {
        const d = doc({ a: { deep: { v: 1 } }, b: 2 })
        let deep: number | undefined
        let other: number | undefined
        const dispose = effect(() => {
            deep = d.read<number | undefined>('a/deep/v')
        })
        const disposeOther = effect(() => {
            other = d.read<number>('b')
        })
        expect(deep).toBe(1)
        d.remove('a') // a and all of a's descendants drop
        expect(deep).toBeUndefined()
        expect(other).toBe(2) // a sibling subtree is untouched
        dispose()
        disposeOther()
    })

    test('churn that fully empties then refills a container stays consistent', () => {
        const d = doc({ list: ['0', '1', '2', '3'] })
        const readAll = () =>
            [0, 1, 2, 3].map((index) => d.read<string | undefined>(`list/${index}`))
        const dispose = effect(() => {
            readAll() // subscribe every index slot
        })
        d.remove('list/0')
        d.remove('list/0')
        d.remove('list/0')
        d.remove('list/0') // emptied
        expect(d.snapshot()).toEqual({ list: [] })
        d.add('list/-', 'x')
        d.add('list/-', 'y')
        expect(readAll()).toEqual(['x', 'y', undefined, undefined])
        dispose()
    })
})
