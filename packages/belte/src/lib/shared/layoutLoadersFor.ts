import type { LayoutEntry } from '../types/LayoutEntry.ts'
import type { Layouts } from '../types/Layouts.ts'
import { routePrefixes } from './routePrefixes.ts'

/*
Returns the layout loaders applicable to `route` for the given kind, paired
with their directory prefix. The narrowed return type lets callers invoke the
loader without an extra existence check or non-null assertion.
*/
export function layoutLoadersFor<K extends 'view' | 'resolve'>(
    route: string,
    layouts: Layouts | undefined,
    kind: K,
): Array<{ prefix: string; load: NonNullable<LayoutEntry[K]> }> {
    if (!layouts) {
        return []
    }
    return routePrefixes(route).flatMap((prefix) => {
        const load = layouts[prefix]?.[kind]
        if (!load) {
            return []
        }
        return [{ prefix, load }]
    })
}
