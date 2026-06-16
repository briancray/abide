import { describe, expect, test } from 'bun:test'
import { createPushIterator } from '../src/lib/shared/createPushIterator.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import type { Subscribable } from '../src/lib/shared/types/Subscribable.ts'
import type { TailHooks } from '../src/lib/shared/types/TailHooks.ts'
import { tail } from '../src/lib/ui/tail.ts'
import { track } from './support/reactiveScope.ts'
import { reconnectable } from './support/reconnectable.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/*
reconnectable with the retention capability: each tail(count, hooks) call is
one connection. The test drives the replay boundary via replayed(frames) —
frames pushed, then the in-band TailHooks signal — plus push/disconnect for
live frames, mirroring how socketProxy unpacks the wire's per-sub `replay`
batch.
*/
function retainingReconnectable<T>(name: string): {
    subscribable: Subscribable<T>
    connections: { push(value: T): void; disconnect(): void; replayed(frames?: T[]): void }[]
} {
    const connections: {
        push(value: T): void
        disconnect(): void
        replayed(frames?: T[]): void
    }[] = []
    const subscribable: Subscribable<T> = {
        name,
        [Symbol.asyncIterator]() {
            throw new Error('the consumer must open through the tail capability')
        },
        tail(_count: number, hooks?: TailHooks) {
            return {
                [Symbol.asyncIterator]() {
                    const iterator = createPushIterator<T>()
                    connections.push({
                        push: (value) => iterator.push(value),
                        disconnect: () => iterator.disconnect(),
                        replayed: (frames = []) => {
                            for (const value of frames) {
                                iterator.push(value)
                            }
                            if (hooks?.replayed) {
                                iterator.control(hooks.replayed)
                            }
                        },
                    })
                    return iterator
                },
            }
        },
    }
    return { subscribable, connections }
}

/*
Reconnect-with-retained-value: a transport disconnect is registry behavior
(retain the value, reopen the iterator), and refreshing(subscribable) is its
reporting layer — flagged only across the gap, never while merely open.
Application errors stay terminal exactly as before.
*/
describe('tail() reconnect-with-retained-value', () => {
    useBrowserWindow()

    test('a disconnect retains the value, flags refreshing, and reopens', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-reconnect')
        const latest = track(() => tail(subscribable))
        const gap = track(() => refreshing(subscribable))

        await settle()
        connections[0].push('a')
        await settle()
        expect(latest.current()).toBe('a')
        expect(gap.current()).toBe(false)
        expect(tail.status(subscribable)).toBe('open')

        connections[0].disconnect()
        await settle()
        /* Value held, gap flagged, status never degrades to error — and a fresh connection opened. */
        expect(latest.current()).toBe('a')
        expect(gap.current()).toBe(true)
        expect(tail.status(subscribable)).toBe('open')
        expect(connections).toHaveLength(2)

        /* The replay landing on the new connection ends the gap. */
        connections[1].push('b')
        await settle()
        expect(latest.current()).toBe('b')
        expect(gap.current()).toBe(false)

        latest.stop()
        gap.stop()
    })

    test('a disconnect before the first frame stays pending — nothing to retain', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-reconnect-cold')
        const latest = track(() => tail(subscribable))

        await settle()
        connections[0].disconnect()
        await settle()
        expect(tail.status(subscribable)).toBe('pending')
        expect(refreshing(subscribable)).toBe(false)
        expect(connections).toHaveLength(2)

        connections[1].push('a')
        await settle()
        expect(latest.current()).toBe('a')
        expect(tail.status(subscribable)).toBe('open')

        latest.stop()
    })

    test('a gap on a non-replaying source keeps the window and appends live frames', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-reconnect-window')
        const recent = track(() => tail(subscribable, { last: 3 }))
        const gap = track(() => refreshing(subscribable))

        await settle()
        connections[0].push('a')
        connections[0].push('b')
        await settle()
        expect(recent.current()).toEqual(['a', 'b'])

        connections[0].disconnect()
        await settle()
        /* Window held across the gap. */
        expect(recent.current()).toEqual(['a', 'b'])
        expect(gap.current()).toBe(true)

        /* No retention capability → nothing replays, nothing can duplicate:
           the first live frame appends instead of wiping the held window. */
        connections[1].push('c')
        await settle()
        expect(recent.current()).toEqual(['a', 'b', 'c'])
        expect(gap.current()).toBe(false)

        recent.stop()
        gap.stop()
    })

    test('an empty replay keeps the held window — the boundary ends the gap, live appends', async () => {
        const { subscribable, connections } = retainingReconnectable<string>('feed-empty-replay')
        const recent = track(() => tail(subscribable, { last: 3 }))
        const gap = track(() => refreshing(subscribable))

        await settle()
        connections[0].replayed()
        connections[0].push('a')
        connections[0].push('b')
        await settle()
        expect(recent.current()).toEqual(['a', 'b'])

        connections[0].disconnect()
        await settle()
        expect(recent.current()).toEqual(['a', 'b'])
        expect(gap.current()).toBe(true)
        expect(connections).toHaveLength(2)

        /* Nothing retained server-side: the bare boundary commits — window kept, gap over. */
        connections[1].replayed()
        await settle()
        expect(recent.current()).toEqual(['a', 'b'])
        expect(gap.current()).toBe(false)

        connections[1].push('c')
        await settle()
        expect(recent.current()).toEqual(['a', 'b', 'c'])

        recent.stop()
        gap.stop()
    })

    test('a non-empty replay commits over the held window in one update', async () => {
        const { subscribable, connections } = retainingReconnectable<string>('feed-atomic-replay')
        const states: string[][] = []
        const recent = track(() => {
            const frames = tail(subscribable, { last: 3 })
            states.push(frames)
            return frames
        })

        await settle()
        connections[0].replayed(['a', 'b'])
        await settle()
        expect(recent.current()).toEqual(['a', 'b'])

        connections[0].disconnect()
        await settle()
        connections[1].replayed(['b', 'c', 'd'])
        await settle()
        expect(recent.current()).toEqual(['b', 'c', 'd'])
        /* Every observed state is a committed seed or an append — never a
           partial frame-by-frame rebuild like ['b'] after holding two. */
        for (const state of states) {
            expect([0, 2, 3]).toContain(state.length)
        }

        recent.stop()
    })

    test('an application error stays terminal — no reconnect', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-reconnect-error')
        const latest = track(() => tail(subscribable))

        await settle()
        connections[0].push('a')
        await settle()
        connections[0].error('stream boom')
        await settle()

        expect(tail.status(subscribable)).toBe('error')
        expect(tail.error(subscribable)?.message).toBe('stream boom')
        expect(refreshing(subscribable)).toBe(false)
        expect(connections).toHaveLength(1)

        latest.stop()
    })

    test('the last reader leaving during a gap cancels the reconnect', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-reconnect-cancel')
        const latest = track(() => tail(subscribable))

        await settle()
        connections[0].push('a')
        await settle()
        connections[0].disconnect()
        await settle()
        expect(connections).toHaveLength(2)

        latest.stop()
        /* Teardown closed the reopened iterator; no third connection appears. */
        connections[1].push('b')
        await settle()
        expect(connections).toHaveLength(2)
        expect(tail.status(subscribable)).toBe('pending')
    })
})
