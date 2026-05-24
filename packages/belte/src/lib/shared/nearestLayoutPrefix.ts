/*
Given a route URL and a sorted list of directory prefixes that have a
layout.svelte, returns the deepest prefix that is an ancestor of the route.
Returns undefined when no layout applies. Implements the "nearest-only"
resolution from the plan — no stacking.
*/
export function nearestLayoutPrefix(
    routeUrl: string,
    layoutPrefixes: Iterable<string>,
): string | undefined {
    const normalized = routeUrl === '/' ? '' : routeUrl.replace(/^\//, '')
    let best: string | undefined
    let bestLen = -1
    for (const prefix of layoutPrefixes) {
        const dir = prefix === '/' ? '' : prefix.replace(/^\//, '')
        if (dir === '' || normalized === dir || normalized.startsWith(`${dir}/`)) {
            if (dir.length > bestLen) {
                best = prefix
                bestLen = dir.length
            }
        }
    }
    return best
}
