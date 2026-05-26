/*
Maps an rpc-relative path (under `src/server/rpc/`) to its URL. Each file
is one endpoint at `/rpc/<file path>`, dropping the `.ts` extension.
$rpc URLs are flat function-call endpoints (args go in query or body), so
bracket-style `[name]` / `[...rest]` segments are rejected — those belong
in `src/pages/` where they map to dynamic path params.
*/
export function rpcUrlForFile(relPath: string): string {
    const withoutExt = relPath.replace(/\.ts$/, '')
    const segments = withoutExt.split('/').filter(Boolean)
    for (const segment of segments) {
        if (segment.startsWith('[')) {
            throw new Error(
                `[belte] src/server/rpc/${relPath} has a dynamic segment '${segment}' — $rpc URLs are flat; pass identifiers via args, not the path`,
            )
        }
    }
    return `/rpc/${segments.join('/')}`
}
