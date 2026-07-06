import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { keyPrefixForRemote } from './keyPrefixForRemote.ts'
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
disagree. Undefined when no prefix exists — bare and tag selectors (they
scan, not prefix-match) and producers never cached (no id was minted;
minting one here would leak identities for probe-only reads).
*/
export function selectorPrefix<Args, Return>(
    arg: CacheSelector<Args, Return> | undefined,
    args?: Args,
): string | undefined {
    if (typeof arg !== 'function') {
        return undefined
    }
    const remote = REMOTE_FUNCTION in arg ? (arg as RawRemoteFunction<Args>) : undefined
    if (remote) {
        return args === undefined
            ? keyPrefixForRemote(remote.method, remote.url)
            : keyForRemoteCall(remote.method, remote.url, args)
    }
    return producerKey.existing(arg, args)
}
