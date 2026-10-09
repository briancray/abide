// A `Store` at an ADDRESS, which is the one thing this example needs of it:
// `storeKeyedCache.ts` builds one per args key so two profiles land at two
// addresses and neither reads back the other's.
//
// IN PROCESS, AND IT SAYS SO. What is actually behind the address is not what
// the example teaches, so the keyed map below stands in for the client, and the
// address is real even where the server is not.

import type { Store } from 'abide'

const AT_ADDRESS = new Map<string, unknown>()

/** A `Store` at `address`, held in this process's memory in place of a redis client. */
export function redisStore<T>(address: string): Store<T> {
    return {
        get: async () => AT_ADDRESS.get(address) as T | undefined,
        set: async (value) => {
            AT_ADDRESS.set(address, value)
        },
    }
}
