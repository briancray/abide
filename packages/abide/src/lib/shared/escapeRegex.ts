/*
Escapes the regex metacharacters in `value` so it can be embedded literally
inside a `new RegExp(...)` pattern. Shared by the $rpc/$sockets import stripper,
the resolver plugin's virtual-namespace matcher, and the SSR snippet-call
rewriter so the same escaping is applied one way everywhere.
*/
export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
