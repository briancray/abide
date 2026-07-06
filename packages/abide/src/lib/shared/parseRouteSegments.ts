export type RouteSegment =
    | { kind: 'literal'; value: string }
    | { kind: 'param'; name: string; catchAll: boolean; optional: boolean }

/*
Splits a abide route URL into typed segments. `[name]` becomes a param,
`[[name]]` an optional param, `[...rest]` a catch-all param, anything else a
literal. Used by matchRoute (both the server's fetch dispatch and the client
router) and writeRoutesDts (client-side `Routes` type augmentation) so the
consumers can't drift on what counts as a param.
*/
export function parseRouteSegments(routeUrl: string): RouteSegment[] {
    return routeUrl.split('/').map((segment) => {
        if (segment.startsWith('[[') && segment.endsWith(']]')) {
            const name = segment.slice(2, -2)
            /* `[[...rest]]` is redundant — a catch-all already matches zero
               segments — but normalizing beats mis-parsing brackets into the name. */
            if (name.startsWith('...')) {
                return { kind: 'param', name: name.slice(3), catchAll: true, optional: false }
            }
            return { kind: 'param', name, catchAll: false, optional: true }
        }
        if (segment.startsWith('[...') && segment.endsWith(']')) {
            return { kind: 'param', name: segment.slice(4, -1), catchAll: true, optional: false }
        }
        if (segment.startsWith('[') && segment.endsWith(']')) {
            return { kind: 'param', name: segment.slice(1, -1), catchAll: false, optional: false }
        }
        return { kind: 'literal', value: segment }
    })
}
