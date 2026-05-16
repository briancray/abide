import type { Layouts } from '../types/Layouts.ts'
import { routePrefixes } from './routePrefixes.ts'

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
