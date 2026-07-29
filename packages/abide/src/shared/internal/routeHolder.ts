// CLIENT ROUTE HOLDER (M5b / C6-nav) — the reactive source `route()` reads on the CLIENT.
//
// On the server `route()` reads the active request scope (per-request, ambient). The browser has no
// request scope, so it reads this module-level reactive holder instead. Reading it inside a reactive
// binding (text/attr effect) SUBSCRIBES, so when a soft-nav replaces the RouteInfo (new params/name/url)
// every `route()`-dependent binding re-runs.
//
// One of three ADOPTED AMBIENTS (see `adoptedAmbient.ts`), which is where the shape lives. Its two
// parameters, and why they are what they are:
//
//   isValid — permissive. A RouteInfo is CONSTRUCTED by `navigate`/`bootstrap` from a matched pattern,
//             never decoded off the wire, so there is no untrusted shape to defend against; the check
//             is just "an object", which rules out a null/undefined seed field.
//   changed — OMITTED, which is the meaningful choice here, not an oversight. With no extra guard the
//             underlying cell's own identity check decides, and `navigate` builds a FRESH RouteInfo per
//             nav — so every nav wakes, including a same-route param/query nav, which is precisely what
//             makes `{await read(route().params)}` re-fire IN PLACE with no DOM swap. `identity` adds a
//             VALUE comparison for the opposite reason: it too decodes a fresh object per nav, and there
//             an equal one means nothing changed.
//
// Lives in `shared/internal` (not `ui`) so `shared/route.ts` can read it without importing UI code,
// keeping the server↔client split clean. Inert on the server (nothing ever calls setClientRoute there).

import { adoptedAmbient } from './adoptedAmbient.ts'
import type { RouteInfo } from './routeInfo.ts'

const holder = adoptedAmbient<RouteInfo>({
    isValid: (value): value is RouteInfo => typeof value === 'object' && value !== null,
})

// Reactive read of the current client route. Tracks when called inside an effect/computed.
export function readClientRoute(): RouteInfo | undefined {
    return holder.read()
}

// Replace the current client route (a fresh object each nav), waking every route()-dependent binding.
export function setClientRoute(info: RouteInfo): void {
    holder.adopt(info)
}

// Reset the holder to "no client route" (used by tests to clear leaked module state between runs).
export function clearClientRoute(): void {
    holder.clear()
}
