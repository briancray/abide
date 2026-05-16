import type { Layouts } from './Layouts.ts'

/**
 * For a route key like "posts/[id]/comments" returns the directory prefixes
 * from root to leaf: ["", "posts", "posts/[id]"]. The leaf segment itself
 * (the route file's basename) is dropped. Used to walk layout chains.
 */
export function routePrefixes(route: string): string[] {
    const segments = route === 'index' ? [] : route.split('/').slice(0, -1)
    const out: string[] = ['']
    for (let i = 0; i < segments.length; i++) {
        out.push(segments.slice(0, i + 1).join('/'))
    }
    return out
}

/**
 * Returns only the prefixes that have a layout entry of the requested kind.
 * Used by both server (SSR) and client (navigation) to compute the view chain.
 */
export function layoutPrefixesFor(
    route: string,
    layouts: Layouts | undefined,
    kind: 'view' | 'resolve',
): string[] {
    if (!layouts) {
        return []
    }
    return routePrefixes(route).filter((p) => layouts[p]?.[kind])
}
