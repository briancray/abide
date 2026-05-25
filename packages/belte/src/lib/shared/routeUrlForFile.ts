/*
Maps a route-relative path (under `src/route/`) to its URL. Each file
is one endpoint at `/route/<file path>`, dropping the `.ts` extension.
$route URLs are flat function-call endpoints (args go in query or body), so
bracket-style `[name]` / `[...rest]` segments are rejected — those belong
in `src/pages/` where they map to dynamic path params.
*/
export function routeUrlForFile(relPath: string): string {
    const withoutExt = relPath.replace(/\.ts$/, '')
    const segments = withoutExt.split('/').filter(Boolean)
    for (const segment of segments) {
        if (segment.startsWith('[')) {
            throw new Error(
                `[belte] src/route/${relPath} has a dynamic segment '${segment}' — $route URLs are flat; pass identifiers via args, not the path`,
            )
        }
    }
    return `/route/${segments.join('/')}`
}
