/*
The result of walking a `/`-joined path through a tree: whether the path still
resolves to an own slot at every segment, and the value it holds. `exists` is
false when a segment is missing (a deleted key, an out-of-range index); `value`
is then `undefined`. Separates a missing path from one holding a real `undefined`.
*/
export type PathWalk = {
    exists: boolean
    value: unknown
}
