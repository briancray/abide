/*
Single-slot-mailbox AsyncIterator factory shared by the in-process
socket fan-out (defineSocket) and the client-side ws proxy
(socketProxy). Callers push values, signal end, or signal an error;
the iterator drains a queue then awaits the next push. Cancellation
runs the optional `onClose` so subscribers can drop their backref.

The pending-value buffer is bounded: a subscriber whose `next()` falls
behind a chatty producer would otherwise grow it without limit, which on
the server is a remotely-triggerable memory-exhaustion vector. At the cap
the oldest pending value is dropped (live fan-out is latest-wins) so
memory stays bounded; terminal end/error slots are always appended and
never dropped.
*/

type Slot<T> = { kind: 'value'; value: T } | { kind: 'end' } | { kind: 'error'; message: string }

export type PushIterator<T> = AsyncIterator<T, void, undefined> & {
    push(value: T): void
    end(): void
    error(message: string): void
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
        // Drop the oldest pending value before exceeding the cap.
        if (slot.kind === 'value' && buffer.length >= maxBuffer) {
            buffer.shift()
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
        end() {
            deliver({ kind: 'end' })
        },
        error(message) {
            deliver({ kind: 'error', message })
        },
        async next() {
            if (closed) {
                return { value: undefined, done: true }
            }
            const slot = buffer.shift() ?? (await new Promise<Slot<T>>((r) => (waiter = r)))
            if (slot.kind === 'end') {
                close()
                return { value: undefined, done: true }
            }
            if (slot.kind === 'error') {
                close()
                throw new Error(slot.message)
            }
            return { value: slot.value, done: false }
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
