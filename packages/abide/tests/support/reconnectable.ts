import { createPushIterator, type PushIterator } from '../../src/lib/shared/createPushIterator.ts'
import type { NamedAsyncIterable } from '../../src/lib/shared/types/NamedAsyncIterable.ts'

/*
A NamedAsyncIterable whose connections the test controls: each
[Symbol.asyncIterator]() call is one "connection" (mirroring socketProxy
minting a fresh sub per iterate), drivable via push/end/error/disconnect.
*/
export function reconnectable<T>(name: string): {
    subscribable: NamedAsyncIterable<T>
    connections: PushIterator<T>[]
} {
    const connections: PushIterator<T>[] = []
    const subscribable: NamedAsyncIterable<T> = {
        name,
        [Symbol.asyncIterator]() {
            const iterator = createPushIterator<T>()
            connections.push(iterator)
            return iterator
        },
    }
    return { subscribable, connections }
}
