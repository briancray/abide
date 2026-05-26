export type RouteSegment =
    | { kind: 'literal'; value: string }
    | { kind: 'param'; name: string; catchAll: boolean }

/*
Splits a belte route URL into typed segments. `[name]` becomes a param,
`[...rest]` becomes a catch-all param, anything else is a literal. Used
by toBunRoutePattern (server-side Bun pattern emission) and writeRoutesDts
(client-side `Routes` type augmentation) so the two consumers can't drift
on what counts as a param.
*/
export function parseRouteSegments(routeUrl: string): RouteSegment[] {
    return routeUrl.split('/').map((segment) => {
        if (segment.startsWith('[...') && segment.endsWith(']')) {
            return { kind: 'param', name: segment.slice(4, -1), catchAll: true }
        }
        if (segment.startsWith('[') && segment.endsWith(']')) {
            return { kind: 'param', name: segment.slice(1, -1), catchAll: false }
        }
        return { kind: 'literal', value: segment }
    })
}
