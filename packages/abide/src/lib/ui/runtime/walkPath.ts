import type { PathWalk } from './types/PathWalk.ts'

/*
Walks a `/`-joined path through a plain tree in one pass, returning both whether
the path still resolves (`exists`) and the value it holds (`value`). `''` is the
root. Arrays index by their numeric segment as a string — JS array access coerces
the key, and `in` covers an own index in range or `length`.

The two answers are inseparable on the eviction path (`createDoc`'s descend),
which must distinguish a path the tree no longer has (a deleted key, an
out-of-range index after a shrink) from one holding a genuine `undefined` — a
distinction the value alone can't make. Returning both walks the path once where
a separate value-read + existence-check would walk it twice.
*/
export function walkPath(tree: unknown, path: string): PathWalk {
    if (path === '') {
        return { exists: tree !== undefined, value: tree }
    }
    let current: unknown = tree
    for (const segment of path.split('/')) {
        if (current === null || typeof current !== 'object' || !(segment in current)) {
            return { exists: false, value: undefined }
        }
        current = (current as Record<string, unknown>)[segment]
    }
    return { exists: true, value: current }
}
