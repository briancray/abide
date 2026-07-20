// CLIENT ROUTE HOLDER (M5b / C6-nav) — the reactive source `route()` reads on the CLIENT.
//
// On the server `route()` reads the active request scope (per-request, ambient). The browser has no
// request scope, so it reads this module-level reactive holder instead. A single M1 signal holds the
// current RouteInfo; reading it inside a reactive binding (text/attr effect) SUBSCRIBES, so when a
// soft-nav replaces the RouteInfo (new params/name/url) every `route()`-dependent binding re-runs.
//
// This lives in `shared/internal` (not `ui`) so `shared/route.ts` can read it without importing UI
// code, keeping the server↔client split clean. It is inert on the server (nothing ever calls
// setClientRoute there).

import { signal } from "./reactive.ts";
import type { RouteInfo } from "../../server/internal/scope.ts";

const clientRoute = signal<RouteInfo | undefined>(undefined);

// Reactive read of the current client route. Tracks when called inside an effect/computed.
export function readClientRoute(): RouteInfo | undefined {
  return clientRoute();
}

// Replace the current client route (a fresh object each nav), waking every route()-dependent binding.
export function setClientRoute(info: RouteInfo): void {
  clientRoute.set(info);
}

// Reset the holder to "no client route" (used by tests to clear leaked module state between runs).
export function clearClientRoute(): void {
  clientRoute.set(undefined);
}
