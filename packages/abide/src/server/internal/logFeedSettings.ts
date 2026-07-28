// Whether this deployment exposes `/__abide/logs`, and how much history it keeps.
//
// `ABIDE_LOGS` is read on the SERVER only, and nothing in `shared/` knows the name: `logFeed` holds a
// plain boolean that this decides at bind. That split is what keeps the opt-in off the hot path (one
// property load per log line) and out of the browser bundle entirely.
//
// Default CLOSED. Every other generated route under `/__abide/` discloses something the caller could
// already reach — its own identity, the health doc, an rpc it may call. This one discloses whatever the
// app happened to log, including lines written on behalf of OTHER users, so it cannot be on by default
// and stay honest.

import { readEnv } from '../../shared/internal/readEnv.ts'

const TRUTHY = ['1', 'true', 'yes', 'on']

export interface LogFeedSettings {
    enabled: boolean
    capacity: number
}

export function logFeedSettings(): LogFeedSettings {
    const flag = readEnv('ABIDE_LOGS')
    const enabled = flag !== undefined && TRUTHY.includes(flag.trim().toLowerCase())
    const requested = Number.parseInt(readEnv('ABIDE_LOG_BUFFER') ?? '', 10)
    // A capacity of 0 would mean "opted in, but keep nothing", which is never what someone who set
    // `ABIDE_LOGS` meant — fall back to the ring's own default rather than serving an empty backlog.
    const capacity = Number.isFinite(requested) && requested > 0 ? requested : 0
    return { enabled, capacity }
}
