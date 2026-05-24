/*
Translates a belte route URL (`/media/[id]/[...rest]`) into the pattern Bun
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
    const pattern = routeUrl
        .split('/')
        .map((segment) => {
            if (segment.startsWith('[...') && segment.endsWith(']')) {
                catchAllName = segment.slice(4, -1)
                return '*'
            }
            if (segment.startsWith('[') && segment.endsWith(']')) {
                return `:${segment.slice(1, -1)}`
            }
            return segment
        })
        .join('/')
    return { pattern, catchAllName }
}
