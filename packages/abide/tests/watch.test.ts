import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { state } from '../src/lib/ui/state.ts'
import { watch } from '../src/lib/ui/watch.ts'

/* watch() is client lifecycle. The cell/rpc branches wrap `effect` (no window guard);
   only the subscribable branch self-guards on the server (via cache.on). `window` is set
   so the subscribable test's cache.on runs client-side. */
describe('watch()', () => {
    const globals = globalThis as Record<string, unknown>
    let realWindow: unknown

    beforeEach(() => {
        realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
    })
    afterEach(() => {
        globals.window = realWindow
    })

    test('watch(cell, handler) runs now and on every change; disposer stops it', () => {
        const count = state(0)
        const seen: number[] = []
        const stop = watch(count, (n) => seen.push(n as number))
        expect(seen).toEqual([0])
        count.value = 1
        expect(seen).toEqual([0, 1])
        stop()
        count.value = 2
        expect(seen).toEqual([0, 1])
    })

    test('watch([a, b], handler) fires on any source change', () => {
        const a = state(1)
        const b = state(2)
        const runs: unknown[][] = []
        const stop = watch([a, b], (values) => runs.push(values))
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

    test('watch(subscribable, handler) runs per frame until done', async () => {
        const frames = [1, 2, 3]
        const sub = {
            async *[Symbol.asyncIterator]() {
                for (const frame of frames) {
                    yield frame
                }
            },
        }
        const seen: number[] = []
        const stop = watch(sub as never, (frame) => {
            seen.push(frame as number)
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(seen).toEqual([1, 2, 3])
        stop()
    })

    test('subscribable reactions are inert on the server (no window)', async () => {
        /* The cell/rpc branches wrap `effect` (no runtime window guard — author `watch` is
           SSR-stripped by the compiler instead). The subscribable branch self-guards at
           runtime via cache.on, so a socket reaction never opens on the server. */
        globals.window = undefined
        const sub = {
            async *[Symbol.asyncIterator]() {
                yield 1
                yield 2
            },
        }
        const seen: number[] = []
        const stop = watch(sub as never, (frame) => {
            seen.push(frame as number)
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(seen).toEqual([])
        stop()
    })
})
