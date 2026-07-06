import { done } from './done.ts'
import { pending } from './pending.ts'
import { refreshing } from './refreshing.ts'
import { tailProbeSlot } from './tailProbeSlot.ts'
import type { Socket } from './types/Socket.ts'

/* The socket surface before the probe sugar is attached — every Socket member except the
   pre-bound probes this module adds. Both construction sites (defineSocket / buildSocketOverChannel)
   build this shape, then the assertion below narrows it to a full Socket. */
type SocketWithoutProbes<T> = Omit<Socket<T>, 'pending' | 'refreshing' | 'done' | 'error'>

/*
Attaches the pre-bound probe sugar onto an assembled Socket, mirroring
attachRpcSelectorMethods for the rpc side: `socket.pending()` ≡ `pending(socket)`,
likewise refreshing / done, and `socket.error()` reads the stream's terminal error (the
tail prober's `error` field — instance-only, no bare global, same as the rpc's `.error`).
The socket is the pre-bound stream selector. The methods reference the globals at call
time, so the shared import edge carries no module-init dependency. Called by both
buildSocketOverChannel (consumer / test) and defineSocket (server) so the two Socket
shapes stay identical; on the server the tail prober is unregistered, so the probes read
the same fallbacks the globals give there (pending true until a frame, refreshing/done
false, error undefined). An assertion return narrows the base object to a full Socket at
each call site, so neither construction literal needs a cast.
*/
export function attachSocketSelectorMethods<T>(
    socket: SocketWithoutProbes<T>,
): asserts socket is Socket<T> {
    Object.assign(socket, {
        pending: () => pending(socket),
        refreshing: () => refreshing(socket),
        done: () => done(socket),
        error: () => tailProbeSlot.probe?.(socket.name)?.error,
    })
}
