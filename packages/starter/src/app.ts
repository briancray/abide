// Process/request-lifecycle hooks + the request/nav middleware onion (CL3). Auth is just middleware:
// a guard calls `error(403)` instead of calling next(). `error(...)`/`redirect(...)` THROW — they are
// typed `never`, not Response-returning — and the chain renders the throw at its own status. So the
// short-circuit is the call itself; there is nothing to `return`.
//
// THIS array is the PER-REQUEST rung: it runs once for the unit of work, so a page with eight reads
// is eight reads inside ONE pass of it. An rpc's own `middleware` — `GET(fn, { middleware: [...] })` —
// is the PER-READ rung, and it runs from every door the read comes through, page SSR and a sibling
// handler's read included, not only over HTTP. Put "this request" concerns (tracing, rate limiting a
// visitor) here; put "this read" concerns (authorizing these args) on the rpc.
import { error } from 'abide/server/error'

export const middleware = []

// onStart/onStop WRAP the real boot/teardown: run setup, then `await start()` to bind the server
// (returning without it aborts boot); `await stop()` tears it down.
export async function onStart(start: () => Promise<void>): Promise<void> {
    await start()
}

export async function onStop(stop: () => Promise<void>): Promise<void> {
    await stop()
}

// onHealth runs on every server-side `health()` call (including GET /__abide/health, where it is still
// in request scope). Its fields merge OVER the framework baseline `{ reachable, version, startedAt,
// uptime }`; returning `reachable: false` — or throwing — makes the endpoint answer 503. Its RETURN
// TYPE is what the generated `src/.abide/health.d.ts` carries into `health()`, so declaring this hook
// is also how `(await health()).ready` becomes a typed read. Replace `ready` with a real probe.
export function onHealth(): { ready: boolean } {
    return { ready: true }
}

// onError is the outermost net for an UNEXPECTED throw during a request. A deliberate
// `error(...)`/`redirect(...)` throws too, but the chain answers it at its own status BEFORE this runs
// — a declared 404 is not a bug in the app. Request-scoped, so `request()`/`route()`/`identity()` read
// ambiently. Shape the reply by calling `error(...)` (or by returning a Response); return nothing to
// fall back to a generic 500.
export function onError(_caught: unknown): never {
    error(500, 'Something went wrong.')
}
