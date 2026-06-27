import { parseRouteSegments } from './parseRouteSegments.ts'

/*
The TypeScript type literal for a route's path params — `{ "id": string }` for
`/post/[id]`, `Record<string, never>` for a param-less route. Walks the `[name]` /
`[...rest]` segments; catch-all segments map to `string` under their declared name
(the server's toBunRoutePattern renames Bun's `*` key back to that name when
dispatching, so the page sees `params.rest`, not `params['*']`). The single source of
truth shared by `writeRoutesDts` (page.params typing) and the `.abide` check shadow
(page `props()` typing).
*/
export function routeParamsShape(routeUrl: string): string {
    const keys = parseRouteSegments(routeUrl)
        .filter((segment) => segment.kind === 'param')
        .map((segment) => segment.name)
    if (keys.length === 0) {
        return 'Record<string, never>'
    }
    return `{ ${keys.map((key) => `${JSON.stringify(key)}: string`).join('; ')} }`
}
