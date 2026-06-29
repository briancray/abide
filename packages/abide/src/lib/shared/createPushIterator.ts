/*
Bounded-queue AsyncIterator factory shared by the in-process
socket fan-out (defineSocket) and the client-side ws proxy
(socketProxy). Callers push values, signal end, signal an error, or
signal a transport disconnect; the iterator drains a queue then awaits
the next push. Cancellation runs the optional `onClose` so subscribers
can drop their backref. `disconnect()` is terminal like `error()` but
throws the typed SocketDisconnectedError so consumers can tell a
recoverable transport loss from an application error.

The pending-value buffer is bounded: a subscriber whose `next()` falls
behind a chatty producer would otherwise grow it without limit, which on
the server is a remotely-triggerable memory-exhaustion vector. At the cap
the oldest pending value is dropped (live fan-out is latest-wins) so
memory stays bounded; terminal end/error slots are always appended and
never dropped.
*/

import { SocketDisconnectedError } from './SocketDisconnectedError.ts'

type Slot<T> =
    | { kind: 'value'; value: T }
    | { kind: 'control'; run: () => void }
    | { kind: 'end' }
    | { kind: 'error'; message: string }
    | { kind: 'disconnect' }

export type PushIterator<T> = AsyncIterator<T, void, undefined> & {
    push(value: T): void
    /*
    Queues an in-band signal (e.g. the replay/live boundary): `run` executes
    inside next() when drained, strictly ordered against pushed values, and
    is invisible to the consumer — next() continues to the following slot.
    Never dropped by the buffer cap.
    */
    control(run: () => void): void
    end(): void
    error(message: string): void
    disconnect(): void
}

const DEFAULT_MAX_BUFFER = 1024

export function createPushIterator<T>(
    onClose?: () => void,
    maxBuffer = DEFAULT_MAX_BUFFER,
): PushIterator<T> {
    const buffer: Slot<T>[] = []
    let waiter: ((slot: Slot<T>) => void) | undefined
    let closed = false

    function deliver(slot: Slot<T>): void {
        if (closed) {
            return
        }
        if (waiter) {
            const wake = waiter
            waiter = undefined
            wake(slot)
            return
        }
        /* Drop the OLDEST value slot before exceeding the cap — never a control or
           terminal slot (end/error/disconnect), which the contract guarantees are
           never dropped. If the buffer holds only non-value slots, drop nothing. */
        if (slot.kind === 'value' && buffer.length >= maxBuffer) {
            const oldestValue = buffer.findIndex((pending) => pending.kind === 'value')
            if (oldestValue !== -1) {
                buffer.splice(oldestValue, 1)
            }
        }
        buffer.push(slot)
    }

    function close(): void {
        if (closed) {
            return
        }
        closed = true
        onClose?.()
    }

    return {
        push(value) {
            deliver({ kind: 'value', value })
        },
        control(run) {
            deliver({ kind: 'control', run })
        },
        end() {
            deliver({ kind: 'end' })
        },
        error(message) {
            deliver({ kind: 'error', message })
        },
        disconnect() {
            deliver({ kind: 'disconnect' })
        },
        async next() {
            while (true) {
                if (closed) {
                    return { value: undefined, done: true }
                }
                const slot = buffer.shift() ?? (await new Promise<Slot<T>>((r) => (waiter = r)))
                if (slot.kind === 'control') {
                    slot.run()
                    continue
                }
                if (slot.kind === 'end') {
                    close()
                    return { value: undefined, done: true }
                }
                if (slot.kind === 'error') {
                    close()
                    throw new Error(slot.message)
                }
                if (slot.kind === 'disconnect') {
                    close()
                    throw new SocketDisconnectedError()
                }
                return { value: slot.value, done: false }
            }
        },
        async return() {
            if (!closed) {
                close()
                waiter?.({ kind: 'end' })
                waiter = undefined
            }
            return { value: undefined, done: true }
        },
    }
}
