import type { Route } from './Route.ts'

/* A code-split page entry: imports the page chunk on demand, yielding its default
   Route. The router resolves a loader on first match and caches the result, so
   each page's chunk downloads only when its route is first visited — not all of
   them up front at boot. Mirrors the `_virtual/pages` manifest shape. */
export type RouteLoader = () => Promise<{ default: Route }>
