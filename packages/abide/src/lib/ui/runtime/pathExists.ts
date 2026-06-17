/*
Whether a `/`-joined path still resolves through `tree` — every segment present
in its container. The `in` operator covers both shapes: an object key, an array's
own index (in range) or its `length`. Distinguishes a path the tree no longer has
(a deleted key, an out-of-range index after a shrink) from one holding a genuine
`undefined`, which `valueAtPath` alone can't — used to evict dead reactive nodes.
*/
export function pathExists(tree: unknown, path: string): boolean {
    if (path === '') {
        return tree !== undefined
    }
    let current: unknown = tree
    for (const segment of path.split('/')) {
        if (current === null || typeof current !== 'object') {
            return false
        }
        if (!(segment in current)) {
            return false
        }
        current = (current as Record<string, unknown>)[segment]
    }
    return true
}
