import { CACHE_STALENESS_SOCKET } from '../../shared/CACHE_STALENESS_SOCKET.ts'
import { serializeSelector } from '../../shared/serializeSelector.ts'
import type { CacheSelector } from '../../shared/types/CacheSelector.ts'
import { lookupSocket } from '../sockets/lookupSocket.ts'

/*
The server half of the isomorphic staleness verbs (ADR-0041): serialize the selector
to the cross-client envelope and publish it on the reserved __abide/cache socket so
every connected browser applies the same drop/refetch locally. Installed as the
cacheStalenessSlot resolver by serverEntry ONLY — never imported from a shared or ui
module. That single discipline is what keeps this server socket code (and lookupSocket)
out of the client bundle: the ADR-0022 DCE guard polices the app's own src/server edge,
NOT abide's internal lib/server modules, so it would NOT catch a leak from here — the
resolver-slot indirection is the actual guarantee. Do not import this from a
client-reachable module.

serializeSelector throws for a producer/closure or bare match-all selector (not
cross-client serializable) — the throw surfaces at the mutation site as the
programming error it is. Publishing is subscriber-gated by defineSocket.publish
(it skips the encode + native fan-out when no ws client is subscribed), and the
reserved socket keeps no tail, so a frame published to nobody simply evaporates.
*/
export function broadcastCacheStaleness<Args, Return>(
    op: 'invalidate' | 'refresh',
    selector: CacheSelector<Args, Return>,
    args?: Args,
): void {
    const frame = serializeSelector(op, selector, args)
    /* Resolved lazily from the registry — the socket is minted at server boot, before any
       request-scoped mutation can call a staleness verb. Absent only in a degenerate boot. */
    const entry = lookupSocket(CACHE_STALENESS_SOCKET)
    entry?.socket.publish(frame)
}
