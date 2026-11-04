// 31.9 — AN ARRAY MUTATOR CALLED ON A NAME IS A WRITE THROUGH ITS RECEIVER'S PATH, resolved from the
// receiver's type. Called on the held array, `tags.push(t)` grows it in place: the value reads right,
// no `set` runs, the identity a reader wakes on never moves, and the page stays as it was painted.

import { afterAll, expect, test } from 'bun:test'

import { flushSync, reactive } from '#shared'
import { mutatePath } from '#shared/writePath.ts'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, lower, mountPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

// THE REVERT: drop `liftedMutators`' answer from `classifyRead` (pass `false`); every line below
// then lowers to `tags().push('b')` — 6 calls on the held value, and not one write.
test('an array mutator on a name lowers to a write through its path — 31.9', async () => {
    const lowered = await lower(`const tags = reactive(['a'])
tags.push('b')
const n = tags.pop()
const deal = reactive({ notes: ['x'], rows: [['y']] })
deal.notes.splice(0, 1)
deal.rows[0].push('z')
deal.notes?.reverse()`)
    expect(lowered).toContain(
        "__mutatePath(tags, [], (__mutated) => __mutated.push('b'))",
    )
    expect(lowered).toContain(
        'const n = __mutatePath(tags, [], (__mutated) => __mutated.pop())',
    )
    expect(lowered).toContain(
        '__mutatePath(deal, ["notes"], (__mutated) => __mutated.splice(0, 1))',
    )
    expect(lowered).toContain(
        '__mutatePath(deal, ["rows", 0], (__mutated) => __mutated.push(\'z\'))',
    )
    expect(lowered).toContain(
        '__mutatePath(deal, ["notes"], (__mutated) => __mutated?.reverse())',
    )
})

// THE TYPE DECIDES, NOT THE NAME. A class's own `push`, a `Map`'s `set`, an array method that does
// not mutate, and a value typed `any` are each left the call on the value they were.
test('a mutator name on a receiver that is not an array stays a call on the value — 31.9', async () => {
    const lowered =
        await lower(`class Stack { push(item: string) { return item } }
const stack = reactive(new Stack())
stack.push('a')
const lookup = reactive(new Map<string, number>())
lookup.set('a', 1)
const tags = reactive(['a'])
const joined = tags.join(',')
const loose = reactive(undefined as any)
loose.push(1)`)
    expect(lowered).toContain("stack().push('a')")
    expect(lowered).toContain("lookup().set('a', 1)")
    expect(lowered).toContain("const joined = tags().join(',')")
    expect(lowered).toContain('loose().push(1)')
    expect(lowered).not.toContain('__mutatePath')
})

// THE WORK: one write per call, a copy each time, and the array a reader held never changed under it.
test('a lifted mutator wakes its readers once and leaves the old array as it was — 31.9', () => {
    const tags = reactive(['a'])
    const before = tags()
    let wakes = 0
    const stop = tags.watch(() => {
        wakes += 1
    })
    flushSync()
    wakes = 0
    expect(mutatePath(tags, [], (held: string[]) => held.push('b'))).toBe(2)
    flushSync()
    expect(tags()).toEqual(['a', 'b'])
    expect(before).toEqual(['a'])
    expect(wakes).toBe(1)
    stop()
})

// 31.14 — a level that is not plain data on the way takes the call in place, and wakes nobody.
test('a mutator through a value that is not plain data is called in place — 31.9, 31.14', () => {
    class Holder {
        rows = ['a']
    }
    const held = new Holder()
    const holder = reactive({ held })
    let wakes = 0
    const stop = holder.watch(() => {
        wakes += 1
    })
    flushSync()
    wakes = 0
    mutatePath(holder, ['held', 'rows'], (rows: string[]) => rows.push('b'))
    flushSync()
    expect(held.rows).toEqual(['a', 'b'])
    expect(holder().held).toBe(held)
    expect(wakes).toBe(0)
    stop()
})

// END TO END: the page a click pushes into repaints.
test('a push in a listener repaints what reads the list — 31.9', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let tags = reactive(['a'])
</script>

<button id="add" onclick={() => tags.push('b')}>add</button>
<p id="out">{tags.join(',')}</p>`)
    ;(document.getElementById('add') as HTMLButtonElement).click()
    flushSync()
    expect(document.getElementById('out')?.textContent).toBe('a,b')
})
