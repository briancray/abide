/*
Single-slot-mailbox AsyncIterator factory shared by the in-process
socket fan-out (defineSocket) and the client-side ws proxy
(socketProxy). Callers push values, signal end, or signal an error;
the iterator drains a queue then awaits the next push. Cancellation
runs the optional `onClose` so subscribers can drop their backref.
*/

type Slot<T> = { kind: 'value'; value: T } | { kind: 'end' } | { kind: 'error'; message: string }

export type PushIterator<T> = AsyncIterator<T, void, undefined> & {
    push(value: T): void
    end(): void
    error(message: string): void
}

export function createPushIterator<T>(onClose?: () => void): PushIterator<T> {
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
