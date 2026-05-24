import { toRoutePattern } from './toRoutePattern.ts'

/*
Maps an rpc-relative path (under `src/rpc/`) to its URL route. Each file
is one endpoint at `/rpc/<file path>`, dropping the `.ts` extension.
`[name]` segments become `:name`, `[...rest]` becomes `*`. The module
itself exports up to six verb-named handlers (GET/POST/PUT/PATCH/DELETE/HEAD)
which all share the URL derived here.
*/
export function rpcUrlForFile(relPath: string): string {
    const withoutExt = relPath.replace(/\.ts$/, '')
    const segments = withoutExt.split('/').filter(Boolean).map(toRoutePattern)
    return `/rpc/${segments.join('/')}`
}
