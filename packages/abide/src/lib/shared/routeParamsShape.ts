import { parseRouteSegments } from './parseRouteSegments.ts'

/*
The TypeScript type literal for a route's path params — `{ "id": string }` for
`/post/[id]`, `Record<string, never>` for a param-less route. Walks the `[name]` /
`[[name]]` / `[...rest]` segments; a catch-all maps to `string` under its declared
name (matchRoute captures it there, `''` when it consumed nothing), and an
`[[optional]]` maps to an optional key (absent from params when unmatched). The
single source of truth shared by `writeRoutesDts` (page.params typing) and the
`.abide` check shadow (page `props()` typing).
*/
export function routeParamsShape(routeUrl: string): string {
    const entries = parseRouteSegments(routeUrl)
        .filter((segment) => segment.kind === 'param')
        .map((segment) => `${JSON.stringify(segment.name)}${segment.optional ? '?' : ''}: string`)
    if (entries.length === 0) {
        return 'Record<string, never>'
    }
    return `{ ${entries.join('; ')} }`
}
