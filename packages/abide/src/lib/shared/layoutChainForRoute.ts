/*
The ordered layout chain that wraps a page route: every directory prefix that
holds a `layout.abide` and is an ancestor of (or equal to) the route, outermost
first. `layoutKeys` are directory URLs (a layout's URL is its folder path, via
pageUrlForFile). `/` matches every route; a deeper prefix matches when the route
equals it or descends into it. Dynamic segments compare literally (`/media/[id]`)
since both keys and routes carry the same `[name]` form. Pure — both the SSR
renderer and the client router resolve a page's chain from the same function so
they nest identically.
*/
export function layoutChainForRoute(routeUrl: string, layoutKeys: Iterable<string>): string[] {
    const route = routeUrl === '/' ? '' : routeUrl.replace(/^\//, '')
    const applies: string[] = []
    for (const key of layoutKeys) {
        const dir = key === '/' ? '' : key.replace(/^\//, '')
        if (dir === '' || route === dir || route.startsWith(`${dir}/`)) {
            applies.push(key)
        }
    }
    /* Outermost first: a shorter prefix is an ancestor of a longer one. */
    return applies.sort((first, second) => first.length - second.length)
}
