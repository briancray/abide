import { createSignalNode } from '../ui/runtime/createSignalNode.ts'
import { track } from '../ui/runtime/track.ts'
import { trigger } from '../ui/runtime/trigger.ts'

/*
The rpc's error memory — the last error per call identity (the keyForRemoteCall
key), recorded at the rpc call boundary and cleared on a later success or
invalidate. Orthogonal to the cache entry lifecycle (design Fork 1): the cache
still evicts on error exactly as before; this remembers the error for reactive
reads. One shared signal node backs reactivity — readers `track` it, writers
`trigger` it — the same coarse lifecycle-channel pattern the cache probes use.
*/
const node = createSignalNode(undefined)
const errors = new Map<string, unknown>()

/* Insertion order = recency; a re-record moves the key to the tail so readAny returns latest. */
function bump(key: string, error: unknown): void {
    errors.delete(key)
    errors.set(key, error)
}

export const rpcErrorRegistry = {
    record(key: string, error: unknown): void {
        bump(key, error)
        trigger(node)
    },
    clear(key: string): void {
        if (errors.delete(key)) {
            trigger(node)
        }
    },
    read(key: string): unknown {
        track(node)
        return errors.get(key)
    },
    /* Most-recent error whose key is, or is prefixed by, the fn selector's `method url`. */
    readAny(prefix: string): unknown {
        track(node)
        let latest: unknown
        for (const [key, error] of errors) {
            if (key === prefix || key.startsWith(`${prefix} `)) {
                latest = error
            }
        }
        return latest
    },
}
