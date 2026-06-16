import { parseBoundedEnvInt } from '../shared/parseBoundedEnvInt.ts'
import { createReachable } from './runtime/createReachable.ts'

/*
Server-only outbound reachability for an external host. `await reachable(host)`
HEADs the host's origin: the first call awaits a real probe (faithful — a down
host costs the full timeout, an up host one handshake) and starts a background
poll that re-probes every TTL, so every later call resolves instantly off the
warm value, fresh within one TTL. A down host going down is caught within
~failureLimit polls; recovery flips it back automatically.

  if (!(await reachable('api.example.com'))) return error(503)

A bare host defaults to https; pass an explicit http://… for a non-TLS host.
Answers "can I connect to this host," NOT "is my endpoint healthy": any
completed HTTP response (even 4xx/5xx, even a 405 to HEAD) counts as reachable;
only a connection failure or timeout reads as unreachable. There is no ambient
server-side connectivity signal, so this is the honest way to fail a doomed
outbound call fast — see online() for the inbound/client-reported counterpart.

ABIDE_REACHABLE_TTL (poll cadence / freshness, ms) and ABIDE_REACHABLE_TIMEOUT
(per-HEAD bound, ms) tune the defaults; the timeout is deliberately generous so
a healthy-but-distant host over a slow link is not mis-read as down.
*/
const TTL_MS = parseBoundedEnvInt(process.env.ABIDE_REACHABLE_TTL, 1_000, 600_000) ?? 30_000
const TIMEOUT_MS = parseBoundedEnvInt(process.env.ABIDE_REACHABLE_TIMEOUT, 100, 60_000) ?? 3_000
/* Stop polling a host nobody has read in a few TTLs; the next read restarts it cold. */
const IDLE_MS = TTL_MS * 3

/* Status-agnostic HEAD: a completed response proves connectivity; reject/timeout does not. */
async function probeOrigin(origin: string): Promise<boolean> {
    try {
        await fetch(origin, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) })
        return true
    } catch {
        return false
    }
}

// @readme observability
export const reachable = createReachable({
    probe: probeOrigin,
    intervalMs: TTL_MS,
    idleMs: IDLE_MS,
}).reachable
