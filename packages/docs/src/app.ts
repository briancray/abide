// Process/request lifecycle hooks + the request/nav middleware onion. Driven live on the
// /platform/lifecycle page. Auth is just middleware: a guard returns error(403) instead of next().
import { error } from 'abide/server/error'

export const middleware = []

// onStart WRAPS boot: do setup, then `await start()` to bind the server — nothing serves until this
// resolves (returning without calling start() aborts boot). We seed a bootId BEFORE start(); onHealth
// surfaces it, proving onStart ran first.
let bootId = ''
export async function onStart(start: () => Promise<void>): Promise<void> {
    bootId = Bun.randomUUIDv7()
    await start()
}

// onStop WRAPS teardown: drain here, then `await stop()`. Not observable from a live page (shown as
// source only); teardown is backstopped if a hook forgets to call stop().
export async function onStop(stop: () => Promise<void>): Promise<void> {
    await stop()
}

// onHealth runs on every GET /__abide/health, INSIDE request scope. Its fields merge OVER the
// framework stub `{ reachable, version, startedAt, uptime }` (app fields win). `bootId` proves onStart
// ran; returning `reachable: false` (or throwing) makes the endpoint answer 503.
export function onHealth(): { app: string; bootWrappedBy: string; bootId: string } {
    return { app: 'docs', bootWrappedBy: 'onStart', bootId }
}

// onError is the outermost net for an UNEXPECTED throw during a request (a typed error()/redirect() is
// a returned Response, not a throw, so it never reaches here). Runs in request scope. Returning a
// Response shapes the client reply; returning nothing falls back to a generic 500.
export function onError(_error: unknown): Response {
    return error(500, 'This handler threw on purpose — onError caught it and shaped this reply.')
}
