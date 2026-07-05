import { describe, expect, test } from 'bun:test'
import { done } from '../src/lib/shared/done.ts'
import type { Subscribable } from '../src/lib/shared/types/Subscribable.ts'
import type { TailHooks } from '../src/lib/shared/types/TailHooks.ts'
import { tail } from '../src/lib/ui/tail.ts'
import { track } from './support/reactiveScope.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/* Builds a Subscribable<T> from a finite frame list; records whether the
   reader cancelled it (last-reader cleanup calls iterator.return) and how
   many times it was opened. */
function source<T>(name: string, frames: T[]) {
    let returned = false
    let opens = 0
    const subscribable: Subscribable<T> = {
        name,
        async *[Symbol.asyncIterator]() {
            opens++
            try {
                for (const value of frames) {
                    // Yield across microtasks so the reactive scope observes each frame.
                    await Promise.resolve()
                    yield value
                }
            } finally {
                returned = true
            }
        },
    }
    return { subscribable, wasReturned: () => returned, openCount: () => opens }
}

/* A Subscribable with the optional retention capability: tail(count, hooks)
   replays the last `count` of `kept`, signals the replay boundary per the
   TailHooks contract, then ends; records each requested count. */
function retainingSource<T>(name: string, kept: T[]) {
    const requested: number[] = []
    const subscribable: Subscribable<T> = {
        name,
        async *[Symbol.asyncIterator]() {
            /* live pipe — nothing arrives; the consumer must prefer tail() */
        },
        tail(count: number, hooks?: TailHooks) {
            requested.push(count)
            const replay = kept.slice(-count)
            return {
                async *[Symbol.asyncIterator]() {
                    for (const value of replay) {
                        await Promise.resolve()
                        yield value
                    }
                    hooks?.replayed?.()
                },
            }
        },
    }
    return { subscribable, requested }
}

describe('tail() reactive consumer', () => {
    useBrowserWindow()

    test('tracks the latest frame and settles to done', async () => {
        const { subscribable, wasReturned } = source('feed-latest', ['a', 'b', 'c'])
        const tracked = track(() => tail(subscribable))

        await settle()
        expect(tracked.current()).toBe('c')
        expect(tail.status(subscribable)).toBe('done')
        expect(done(subscribable)).toBe(true)

        // Last reader stops → the underlying iterator is closed.
        tracked.stop()
        expect(wasReturned()).toBe(true)
    })

    test('exposes a thrown stream through tail.error without crashing the read', async () => {
        const subscribable: Subscribable<number> = {
            name: 'feed-error',
            async *[Symbol.asyncIterator]() {
                await Promise.resolve()
                yield 1
                throw new Error('stream boom')
            },
        }
        const tracked = track(() => tail(subscribable))

        await settle()
        // The read still resolves to the last good frame; the error is side-channelled.
        expect(tracked.current()).toBe(1)
        expect(tail.status(subscribable)).toBe('error')
        expect(tail.error(subscribable)?.message).toBe('stream boom')
        expect(done(subscribable)).toBe(false)
        tracked.stop()
    })

    test('two readers of the same name share one underlying subscription', async () => {
        const { subscribable, openCount } = source('feed-shared', [7])
        const first = track(() => tail(subscribable))
        const second = track(() => tail(subscribable))

        await settle()
        expect(first.current()).toBe(7)
        expect(second.current()).toBe(7)
        // Registry dedupes by name, so the iterator opened once for both readers.
        expect(openCount()).toBe(1)

        first.stop()
        second.stop()
    })

    test('a window holds the last ≤`last` frames and caps as frames arrive', async () => {
        const { subscribable } = source('feed-window', [1, 2, 3, 4, 5])
        const recent = track(() => tail(subscribable, { last: 3 }))

        await settle()
        expect(recent.current()).toEqual([3, 4, 5])
        expect(tail.status(subscribable, { last: 3 })).toBe('done')
        recent.stop()
    })

    test('the bare form and a window are independent subscriptions', async () => {
        const { subscribable, openCount } = source('feed-both-forms', ['x', 'y'])
        const latest = track(() => tail(subscribable))
        const recent = track(() => tail(subscribable, { last: 2 }))

        await settle()
        expect(latest.current()).toBe('y')
        expect(recent.current()).toEqual(['x', 'y'])
        // Distinct registry keys → each form opened its own iterator.
        expect(openCount()).toBe(2)

        latest.stop()
        recent.stop()
    })

    test('a retaining source bounds replay to what the reader keeps', async () => {
        const { subscribable, requested } = retainingSource('feed-retained', ['a', 'b', 'c'])
        const latest = track(() => tail(subscribable))
        const recent = track(() => tail(subscribable, { last: 2 }))

        await settle()
        // Latest-wins seeds from 1 replayed frame; the window asks for exactly `last`.
        expect(latest.current()).toBe('c')
        expect(recent.current()).toEqual(['b', 'c'])
        expect(requested.toSorted()).toEqual([1, 2])

        latest.stop()
        recent.stop()
    })

    test('a retaining source that ends without signalling still commits its seed', async () => {
        const subscribable: Subscribable<string> = {
            name: 'feed-unsignalled',
            async *[Symbol.asyncIterator]() {},
            tail(count: number) {
                const replay = ['a', 'b', 'c'].slice(-count)
                return {
                    async *[Symbol.asyncIterator]() {
                        for (const value of replay) {
                            await Promise.resolve()
                            yield value
                        }
                        /* contract violation: no hooks.replayed — done must commit */
                    },
                }
            },
        }
        const recent = track(() => tail(subscribable, { last: 2 }))

        await settle()
        expect(recent.current()).toEqual(['b', 'c'])
        expect(tail.status(subscribable, { last: 2 })).toBe('done')
        recent.stop()
    })

    test('rejects a non-positive or fractional `last`', () => {
        const { subscribable } = source('feed-invalid-last', [1])
        expect(() => tail(subscribable, { last: 0 })).toThrow(RangeError)
        expect(() => tail(subscribable, { last: 2.5 })).toThrow(RangeError)
    })
})
