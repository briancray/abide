import { keyForRemoteCall } from './keyForRemoteCall.ts'
import { keyPrefixForRemote } from './keyPrefixForRemote.ts'
import { REMOTE_FUNCTION } from './REMOTE_FUNCTION.ts'
import { toTagSet } from './toTagSet.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { CacheStalenessFrame } from './types/CacheStalenessFrame.ts'
import type { RawRemoteFunction } from './types/RawRemoteFunction.ts'

/*
Encodes a CacheSelector into the cross-client staleness envelope (ADR-0041) — the
single authoring site for the on-wire selector, reusing the same encoders the read
path keys with (keyForRemoteCall / keyPrefixForRemote) so it can never drift from
selectorMatcher. The three real branches map 1:1 onto the envelope's `mode`:

  fn + args → { mode: 'key',    match: keyForRemoteCall(method, url, args) }
  fn        → { mode: 'prefix', match: keyPrefixForRemote(method, url) }
  { tags }  → { mode: 'tags',   tags }

A producer/closure selector mints a per-process ref id (selectorPrefix) that no
other client shares, and a bare/undefined match-all would nuke every client's whole
cache — both are NOT cross-client serializable, so they THROW here rather than
broadcast. The caller (the server broadcaster) surfaces the throw as a programming
error at the mutation site.
*/
export function serializeSelector<Args, Return>(
    op: CacheStalenessFrame['op'],
    arg?: CacheSelector<Args, Return>,
    args?: Args,
): CacheStalenessFrame {
    if (arg === undefined) {
        throw new Error(
            `[abide] ${op}(): a bare match-all selector cannot broadcast across clients — it would drop every client's whole cache. Pass a remote function or { tags }.`,
        )
    }
    if (typeof arg === 'function') {
        /* Only a remote function carries wire identity (method+url, stable across clients);
           a plain producer's key is a per-process ref id that no other client shares. */
        if (!(REMOTE_FUNCTION in arg)) {
            throw new Error(
                `[abide] ${op}(): a producer/closure selector is not cross-client serializable (its key is a per-process reference id). Broadcast a remote function or { tags }.`,
            )
        }
        const remote = arg as RawRemoteFunction<Args>
        if (args === undefined) {
            return {
                op,
                mode: 'prefix',
                match: keyPrefixForRemote(remote.method, remote.url),
                tags: [],
            }
        }
        return {
            op,
            mode: 'key',
            match: keyForRemoteCall(remote.method, remote.url, args),
            tags: [],
        }
    }
    /* Reject an empty tag set too, not just an absent `tags`: an empty-array selector
       matches nothing locally, so broadcasting it would fan a match-nothing frame out to
       every peer (a wasted store scan). Compute the set once and reuse it. */
    const tags = arg.tags === undefined ? undefined : toTagSet(arg.tags)
    if (tags === undefined || tags.size === 0) {
        throw new Error(
            `[abide] ${op}(): a { tags } selector must list at least one tag to broadcast.`,
        )
    }
    return { op, mode: 'tags', match: '', tags: [...tags] }
}
