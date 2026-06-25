import { unescapeKey } from './unescapeKey.ts'

/*
Splits an escaped JSON-Pointer-style doc path into its REAL key segments
(each segment unescaped). The path strings (parentPath, node-map keys) stay
escaped and re-walked through `walkPath`; segments index the live tree.
*/
export function pathSegments(path: string): string[] {
    return path.split('/').map(unescapeKey)
}
