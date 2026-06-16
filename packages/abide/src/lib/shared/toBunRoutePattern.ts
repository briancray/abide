import { parseRouteSegments } from './parseRouteSegments.ts'

/*
Translates a abide route URL (`/media/[id]/[...rest]`) into the pattern Bun
needs (`/media/:id/*`) for `Bun.serve({ routes })`. Returns the catch-all
segment's original name alongside so the server can rename Bun's `*` param
back to that name on the way out, keeping page-prop destructuring consistent
with the route file path.
*/
export function toBunRoutePattern(routeUrl: string): {
    pattern: string
    catchAllName: string | undefined
} {
    let catchAllName: string | undefined
    const pattern = parseRouteSegments(routeUrl)
        .map((segment) => {
            if (segment.kind === 'literal') {
                return segment.value
            }
            if (segment.catchAll) {
                catchAllName = segment.name
                return '*'
            }
            return `:${segment.name}`
        })
        .join('/')
    return { pattern, catchAllName }
}
