import { beforeAll, describe, expect, test } from 'bun:test'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { eachAsync } from '../src/lib/ui/dom/eachAsync.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { scope } from '../src/lib/ui/runtime/scope.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/* The dom bindings read a global `document`; the mini-DOM provides one headless. */
beforeAll(() => {
    installMiniDom()
})

function host(): HTMLElement {
    return document.createElement('div')
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/* A hand-driven async iterable: `push` feeds the next value (resolving a parked
   `next()` or queueing it), `return()` (which `for await`/the drain calls on
   teardown) latches `returned` and resolves any pending pull as done — mirroring a
   generator's cleanup so the test can prove the iterator was actually closed. */
function channel<T>(): {
    iterable: AsyncIterable<T>
    push: (value: T) => void
    readonly returned: boolean
} {
    const queue: T[] = []
    let parked: ((result: IteratorResult<T>) => void) | undefined
    let returned = false
    const iterable: AsyncIterable<T> = {
        [Symbol.asyncIterator](): AsyncIterator<T> {
            return {
                next(): Promise<IteratorResult<T>> {
                    if (queue.length > 0) {
                        return Promise.resolve({ value: queue.shift() as T, done: false })
                    }
                    return new Promise((resolve) => {
                        parked = resolve
                    })
                },
                return(): Promise<IteratorResult<T>> {
                    returned = true
                    if (parked !== undefined) {
                        const resolve = parked
                        parked = undefined
                        resolve({ value: undefined as never, done: true })
                    }
                    return Promise.resolve({ value: undefined as never, done: true })
                },
            }
        },
    }
    return {
        iterable,
        push(value: T): void {
            if (parked !== undefined) {
                const resolve = parked
                parked = undefined
                resolve({ value, done: false })
            } else {
                queue.push(value)
            }
        },
        get returned(): boolean {
            return returned
        },
    }
}

describe('teardown leaks', () => {
    test('each disposes live row scopes on unmount, releasing their subscriptions', () => {
        /* A per-row effect subscribes to a long-lived signal. On unmount the rows
           must dispose, or they sit in `extern`'s observers for its whole lifetime. */
        const extern = state(0)
        let rowRuns = 0
        const model = doc({ order: ['a', 'b'] })
        const list = document.createElement('ul')
        const dispose = mount(host(), (h) => {
            each(
                list,
                () => model.read<string[]>('order'),
                (key) => key,
                (parent, key) => {
                    const li = document.createElement('li')
                    li.setAttribute('data-id', key)
                    effect(() => {
                        extern.value
                        rowRuns += 1
                    })
                    parent.appendChild(li)
                },
            )
            h.appendChild(list)
        })
        expect(rowRuns).toBe(2) // one effect per row
        extern.value = 1
        expect(rowRuns).toBe(4) // both rows still live
        dispose()
        extern.value = 2
        expect(rowRuns).toBe(4) // rows disposed on unmount → detached from extern
    })

    test('eachAsync cancels its in-flight drain and closes the iterator on unmount', async () => {
        const feed = channel<{ id: string }>()
        const list = document.createElement('ul')
        const dispose = mount(host(), (h) => {
            eachAsync(
                list,
                () => feed.iterable,
                (item) => item.id,
                (parent, item) => {
                    const li = document.createElement('li')
                    li.setAttribute('data-id', item.id)
                    parent.appendChild(li)
                },
                undefined,
            )
            h.appendChild(list)
        })
        feed.push({ id: 'a' })
        await tick()
        expect(list.children.length).toBe(1)
        dispose()
        expect(feed.returned).toBe(true) // iterator.return() ran → the source can clean up
        feed.push({ id: 'b' }) // lands after teardown
        await tick()
        expect(list.children.length).toBe(1) // drain abandoned → no row in the detached list
    })

    test('derived unlinks from its source signal when its scope tears down', () => {
        const extern = state(0)
        let computes = 0
        let cell: { value: number } | undefined
        const dispose = scope(() => {
            cell = derived(() => {
                computes += 1
                return extern.value
            })
        })
        expect(cell?.value).toBe(0) // first read computes + subscribes to extern
        expect(computes).toBe(1)
        extern.value = 1
        expect(cell?.value).toBe(1) // dependency changed → recomputes on read
        expect(computes).toBe(2)
        dispose() // unlink from extern
        extern.value = 2
        /* Detached: extern no longer holds the computed, so a write neither marks it
           dirty nor recomputes it — it stays at its last cached value. */
        expect(cell?.value).toBe(1)
        expect(computes).toBe(2)
    })
})

/* Guards the createDoc node-eviction path: a structural shrink must re-read shifted
   indices correctly, wake an out-of-range reader to undefined, and re-mint a fresh
   node when a churned key returns — the eviction must not corrupt any of these. */
describe('reactive document node eviction', () => {
    test('an array shrink keeps survivors correct and wakes the vanished tail reader', () => {
        const d = doc({ list: ['a', 'b', 'c'] })
        let tail: unknown = 'init'
        let tailRuns = 0
        effect(() => {
            tail = d.read('list/2')
            tailRuns += 1
        })
        expect(tail).toBe('c')
        d.remove('list/0') // ['b','c'] — index 2 now out of range, lower indices shift
        expect(d.read<string[]>('list')).toEqual(['b', 'c'])
        expect(d.read<string>('list/0')).toBe('b') // shifted survivor re-read, not evicted
        expect(tail).toBe(undefined) // out-of-range reader woken to the gone value
        expect(tailRuns).toBe(2)
    })

    test('a churned object key reads its fresh value after remove and re-add', () => {
        const d = doc({ byId: { a: { n: 1 } } })
        expect(d.read<number>('byId/a/n')).toBe(1)
        d.remove('byId/a') // evicts byId/a + byId/a/n
        expect(d.read('byId/a')).toBe(undefined)
        d.add('byId/a', { n: 9 }) // same key returns → fresh node, fresh value
        expect(d.read<number>('byId/a/n')).toBe(9)
    })
})
