/*
Reads the value at a `/`-joined path in a plain tree. `''` is the root. Returns
undefined if any segment is missing — arrays index by their numeric segment as a
string, which works because JS array access coerces the key.
*/
export function valueAtPath(tree: unknown, path: string): unknown {
    if (path === '') {
        return tree
    }
    let current: unknown = tree
    for (const segment of path.split('/')) {
        if (current === null || typeof current !== 'object') {
            return undefined
        }
        current = (current as Record<string, unknown>)[segment]
    }
    return current
}
