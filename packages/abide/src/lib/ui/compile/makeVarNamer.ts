/*
Compile-time generator of unique temp var names: each call appends a fresh
incrementing suffix to `prefix` (`row` → `row0`, `row1`, …). Shared by the
generateSSR / generateBuild codegen passes so the two hand-mirrored traversals
allocate names one way. Runtime block ids stay separate (`$ctx.next++`).
*/
export function makeVarNamer(): (prefix: string) => string {
    let counter = 0
    return (prefix: string): string => `${prefix}${counter++}`
}
