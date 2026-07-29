// THE ROUTE AMBIENT (M5b / C6-nav) — what `route()` reads, on both sides.
//
// On the SERVER the active request scope carries the router's `RouteInfo`. The browser has no request
// scope, so the read falls through to the adopted value bootstrap/soft-nav installed — and reading it
// inside a reactive binding SUBSCRIBES, so when a nav replaces the `RouteInfo` (new params/name/url)
// every `route()`-dependent binding re-runs.
//
// One of three ADOPTED AMBIENTS (see `adoptedAmbient.ts`), which is where the shape lives. Its
// parameters, and why they are what they are:
//
//   isValid   — permissive. A RouteInfo is CONSTRUCTED by `navigate`/`bootstrap` from a matched
//               pattern, never decoded off the wire, so there is no untrusted shape to defend against;
//               the check is just "an object", which rules out a null/undefined seed field.
//   changed   — OMITTED, which is the meaningful choice here, not an oversight. With no extra guard the
//               underlying cell's own identity check decides, and `navigate` builds a FRESH RouteInfo
//               per nav — so every nav wakes, including a same-route param/query nav, which is
//               precisely what makes `{await read(route().params)}` re-fire IN PLACE with no DOM swap.
//               `identity` adds a VALUE comparison for the opposite reason: it too decodes a fresh
//               object per nav, and there an equal one means nothing changed.
//   absent    — THROWS. A route is the one ambient with no honest fallback: every call site is asking
//               "which page is this", and there is no answer before bootstrap that is not a lie.
//
// `peekReactiveScope` rather than `reactiveScope` because the no-context case is a legitimate answer
// here and must not install the process-global default scope on the way to throwing. Reads the CONTEXT,
// not the request scope (ADR 0026), so `shared/` names nothing in `server/`.

import { adoptedAmbient } from './adoptedAmbient.ts'
import { peekReactiveScope } from './reactiveScope.ts'
import type { RouteInfo } from './routeInfo.ts'

export const routeAmbient = adoptedAmbient<RouteInfo, never>({
    isValid: (value): value is RouteInfo => typeof value === 'object' && value !== null,
    fromScope: () => peekReactiveScope()?.route,
    absent: () => {
        throw new Error(
            'route(): no active request scope — call it inside a request handler or after client bootstrap.',
        )
    },
})
