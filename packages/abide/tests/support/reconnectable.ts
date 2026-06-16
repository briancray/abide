import { createPushIterator, type PushIterator } from '../../src/lib/shared/createPushIterator.ts'
import type { Subscribable } from '../../src/lib/shared/types/Subscribable.ts'

/*
A Subscribable whose connections the test controls: each
[Symbol.asyncIterator]() call is one "connection" (mirroring socketProxy
minting a fresh sub per iterate), drivable via push/end/error/disconnect.
*/
export function reconnectable<T>(name: string): {
    subscribable: Subscribable<T>
    connections: PushIterator<T>[]
} {
    const connections: PushIterator<T>[] = []
    const subscribable: Subscribable<T> = {
        name,
        [Symbol.asyncIterator]() {
            const iterator = createPushIterator<T>()
            connections.push(iterator)
            return iterator
        },
    }
    return { subscribable, connections }
}
