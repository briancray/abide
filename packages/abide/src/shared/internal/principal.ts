// WHO the current unit of work is acting as (auth.md AU3). One id, whether that id was proven, and
// whatever else the app merged in through `identity.set()`.
//
// Lives in `shared/internal` (ADR 0026, the same move `RouteInfo` made) because `shared/identity.ts`
// is isomorphic and must name the type it returns without importing up into `server/`. Re-exported
// from `server/internal/requestScope.ts`, where every existing importer already reaches it.
//
// The index signature is the app's: abide owns `id` and `authenticated` and nothing else. It travels
// JSON-only in both directions — sealed into the identity cookie/bearer, and inlined into the
// hydration seed — so a Date put here comes back a string, on every transport, consistently.
export interface Principal {
    id: string
    authenticated: boolean
    [k: string]: unknown
}
