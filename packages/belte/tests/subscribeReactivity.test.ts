import { describe, expect, test } from 'bun:test'
import { subscribe } from '../src/lib/browser/subscribe.ts'
import type { Subscribable } from '../src/lib/shared/types/Subscribable.ts'
import { track } from './support/reactiveScope.svelte.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/* Builds a Subscribable<T> from a finite frame list; records whether the
   reader cancelled it (last-reader cleanup calls iterator.return). */
function source<T>(name: string, frames: T[]) {
    let returned = false
    const subscribable: Subscribable<T> = {
        name,
        async *[Symbol.asyncIterator]() {
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
    return { subscribable, wasReturned: () => returned }
}

describe('subscribe() reactive consumer', () => {
    useBrowserWindow()

    test('tracks the latest frame and settles to done', async () => {
        const { subscribable, wasReturned } = source('feed-latest', ['a', 'b', 'c'])
        const tracked = track(() => subscribe(subscribable))

        await settle()
        expect(tracked.current()).toBe('c')
        expect(subscribe.status(subscribable)).toBe('done')

        // Last reader stops → the underlying iterator is closed.
        tracked.stop()
        expect(wasReturned()).toBe(true)
    })

    test('exposes a thrown stream through subscribe.error without crashing the read', async () => {
        const subscribable: Subscribable<number> = {
            name: 'feed-error',
            async *[Symbol.asyncIterator]() {
                await Promise.resolve()
                yield 1
                throw new Error('stream boom')
            },
        }
        const tracked = track(() => subscribe(subscribable))

        await settle()
        // The read still resolves to the last good frame; the error is side-channelled.
        expect(tracked.current()).toBe(1)
        expect(subscribe.status(subscribable)).toBe('error')
        expect(subscribe.error(subscribable)?.message).toBe('stream boom')
        tracked.stop()
    })

    test('two readers of the same name share one underlying subscription', async () => {
        let opens = 0
        const subscribable: Subscribable<number> = {
            name: 'feed-shared',
            async *[Symbol.asyncIterator]() {
                opens++
                await Promise.resolve()
                yield 7
            },
        }
        const first = track(() => subscribe(subscribable))
        const second = track(() => subscribe(subscribable))

        await settle()
        expect(first.current()).toBe(7)
        expect(second.current()).toBe(7)
        // Registry dedupes by name, so the iterator opened once for both readers.
        expect(opens).toBe(1)

        first.stop()
        second.stop()
    })
})
