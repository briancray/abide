import { createReachable } from './createReachable.ts'
import { parseBoundedEnvInt } from './parseBoundedEnvInt.ts'

/*
Isomorphic outbound reachability. `await reachable(host)` HEADs the host's
origin: the first call awaits a real probe (faithful — a down host costs the
full timeout, an up host one handshake) and caches the verdict for one TTL, so
every later call within the TTL resolves instantly off the cached value. The
first call after the TTL expires re-probes; a host going down (or recovering) is
noticed on the next read past its cached verdict, not continuously.

  if (!(await reachable('api.example.com'))) return error(503)

No host asks about the app's own backend: constant true on the server (the
server IS the backend — health()'s rule) and on a loopback origin (`abide
dev`, a desktop bundle's embedded server — this machine, reachable by
construction even with the network gone); a deployed origin probes like any
other host.

A bare host defaults to https; pass an explicit http://… for a non-TLS host.
Answers "can I connect to this host," NOT "is my endpoint healthy": any
completed HTTP response (even 4xx/5xx, even a 405 to HEAD) counts as reachable;
only a connection failure or timeout reads as unreachable.

Same callable both sides. The server has no ambient connectivity signal, so
this is the honest way to fail a doomed outbound call fast — see online() for
the inbound/client-reported counterpart. The browser probes no-cors (a
completed opaque response proves connectivity without the host's CORS
blessing) and composes navigator.onLine in at read time, so a lost network
reports false instantly instead of waiting out the cached value — except for
loopback hosts, which need no network.

ABIDE_REACHABLE_TTL (cache freshness, ms) and ABIDE_REACHABLE_TIMEOUT
(per-HEAD bound, ms) tune the server defaults; the browser has no env, so it
runs the defaults. The timeout is deliberately generous so a healthy-but-
distant host over a slow link is not mis-read as down.
*/
const env = typeof process === 'undefined' ? undefined : process.env
const TTL_MS = parseBoundedEnvInt(env?.ABIDE_REACHABLE_TTL, 1_000, 600_000) ?? 30_000
const TIMEOUT_MS = parseBoundedEnvInt(env?.ABIDE_REACHABLE_TIMEOUT, 100, 60_000) ?? 3_000

/* Status-agnostic HEAD: a completed response proves connectivity; reject/timeout does not.
   The browser probes no-cors — an opaque response still completes, so a foreign origin
   without CORS headers can't mis-read an up host as down. */
async function probeOrigin(origin: string): Promise<boolean> {
    try {
        await fetch(origin, {
            method: 'HEAD',
            mode: typeof window === 'undefined' ? undefined : 'no-cors',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        return true
    } catch {
        return false
    }
}

const registry = createReachable({
    probe: probeOrigin,
    ttlMs: TTL_MS,
})

/* Loopback = this machine: no network between, so no probe and no offline gate. */
function isLoopbackHost(hostname: string): boolean {
    return (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.startsWith('127.') ||
        hostname === '[::1]'
    )
}

/* Mirrors the registry's normalization: a bare host defaults to https. */
function hostnameOf(host: string | URL): string {
    const url = typeof host === 'string' && !/^https?:\/\//i.test(host) ? `https://${host}` : host
    return new URL(url).hostname
}

// @documentation observability
export function reachable(host?: string | URL): Promise<boolean> {
    if (typeof window === 'undefined') {
        /* No host = the app's own backend, and the server IS the backend. */
        return host === undefined ? Promise.resolve(true) : registry.reachable(host)
    }
    if (host === undefined) {
        /* The app's own backend = the page's origin. Loopback served this very page
           from this machine — reachable by construction, never worth a poll. */
        if (isLoopbackHost(location.hostname)) {
            return Promise.resolve(true)
        }
        host = location.origin
    }
    /* window-gated because Bun defines a partial navigator; `=== false` because only an
       explicit offline report is reliable. A loopback host is exempt — no network needed. */
    if (navigator.onLine === false && !isLoopbackHost(hostnameOf(host))) {
        return Promise.resolve(false)
    }
    return registry.reachable(host)
}
