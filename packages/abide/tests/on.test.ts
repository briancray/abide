import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { on } from '../src/lib/ui/on.ts'
import { state } from '../src/lib/ui/state.ts'

/* on() is client lifecycle — inert unless window is defined. */
describe('on()', () => {
    const globals = globalThis as Record<string, unknown>
    let realWindow: unknown

    beforeEach(() => {
        realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
    })
    afterEach(() => {
        globals.window = realWindow
    })

    test('on(cell, handler) runs now and on every change; disposer stops it', () => {
        const count = state(0)
        const seen: number[] = []
        const stop = on(count, (n) => seen.push(n as number))
        expect(seen).toEqual([0])
        count.value = 1
        expect(seen).toEqual([0, 1])
        stop()
        count.value = 2
        expect(seen).toEqual([0, 1])
    })

    test('on([a, b], handler) fires on any source change', () => {
        const a = state(1)
        const b = state(2)
        const runs: unknown[][] = []
        const stop = on([a, b], (values) => runs.push(values))
        expect(runs).toEqual([[1, 2]])
        a.value = 10
        expect(runs).toEqual([
            [1, 2],
            [10, 2],
        ])
        b.value = 20
        expect(runs).toEqual([
            [1, 2],
            [10, 2],
            [10, 20],
        ])
        stop()
    })

    test('on(subscribable, handler) runs per frame until done', async () => {
        const frames = [1, 2, 3]
        const sub = {
            async *[Symbol.asyncIterator]() {
                for (const frame of frames) {
                    yield frame
                }
            },
        }
        const seen: number[] = []
        const stop = on(sub as never, (frame) => {
            seen.push(frame as number)
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(seen).toEqual([1, 2, 3])
        stop()
    })

    test('inert without window (SSR)', () => {
        globals.window = undefined
        const count = state(0)
        const seen: number[] = []
        const stop = on(count, (n) => seen.push(n as number))
        expect(seen).toEqual([])
        count.value = 1
        expect(seen).toEqual([])
        stop()
    })
})
