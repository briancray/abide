import { CACHE_WRAPPED } from './CACHE_WRAPPED.ts'
import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { producerKey } from './producerKey.ts'
import { REMOTE_FUNCTION } from './REMOTE_FUNCTION.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { RawRemoteFunction } from './types/RawRemoteFunction.ts'

/*
Resolves a fn selector to the key prefix its entries share: a remote keys on
method+url (fn and fn.raw agree — same wire identity), a producer on the
reference id minted at first cache. With `args`, the exact entry key for that
one call instead — derived through the same encoders the read path uses
(keyForRemoteCall / producerKey format), so selector and entry can't
disagree. Undefined when no prefix exists — bare and scope selectors (they
scan, not prefix-match) and producers never cached (no id was minted;
minting one here would leak identities for probe-only reads). The
cache()-wrapper throw lives here so both consumers — the matcher and the
probes' channel tap — reject it before subscribing to anything.
*/
export function selectorPrefix<Args, Return>(
    arg: CacheSelector<Args, Return> | undefined,
    args?: Args,
): string | undefined {
    if (typeof arg !== 'function') {
        return undefined
    }
    if (CACHE_WRAPPED in arg) {
        throw new Error(
            '[belte] a cache() wrapper is not a selector — pass the function it wraps, e.g. pending(getPost), not pending(cache(getPost))',
        )
    }
    const remote = REMOTE_FUNCTION in arg ? (arg as RawRemoteFunction<Args>) : undefined
    if (remote) {
        return args === undefined
            ? `${remote.method} ${remote.url}`
            : keyForRemoteCall(remote.method, remote.url, args)
    }
    return producerKey.existing(arg, args)
}
