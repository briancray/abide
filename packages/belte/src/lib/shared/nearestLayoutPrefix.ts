/*
Given a route URL and a list of directory prefixes that have a
layout.svelte, returns the deepest prefix that is an ancestor of the route.
Returns undefined when no layout applies. Implements the "nearest-only"
resolution from the plan — no stacking.
*/
export type NormalizedLayoutPrefix = {
    prefix: string
    dir: string
}

export function normalizeLayoutPrefixes(prefixes: Iterable<string>): NormalizedLayoutPrefix[] {
    const out: NormalizedLayoutPrefix[] = []
    for (const prefix of prefixes) {
        out.push({ prefix, dir: prefix === '/' ? '' : prefix.replace(/^\//, '') })
    }
    return out
}

export function nearestLayoutPrefix(
    routeUrl: string,
    layoutPrefixes: NormalizedLayoutPrefix[],
): string | undefined {
    const normalized = routeUrl === '/' ? '' : routeUrl.replace(/^\//, '')
    let best: string | undefined
    let bestLen = -1
    for (const { prefix, dir } of layoutPrefixes) {
        if (dir === '' || normalized === dir || normalized.startsWith(`${dir}/`)) {
            if (dir.length > bestLen) {
                best = prefix
                bestLen = dir.length
            }
        }
    }
    return best
}
