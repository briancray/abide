import { mountSwappableRange } from './mountSwappableRange.ts'

/*
Conditional binding — the runtime for `<template if>` (with optional `else`). The
branch's content lives in a RANGE bounded by two comment markers, so a branch may
hold anything — elements, components, text, nested control-flow, snippets — not
just element roots. A 2-case swappable range tracks `condition()` and swaps the
range's content on a truthy↔falsy flip (`render` truthy, `renderElse` falsy); an
unchanged condition is a no-op. See `mountSwappableRange` for the shared
hydrate/swap/teardown semantics.
*/
// @documentation plumbing
export function when(
    parent: Node,
    condition: () => unknown,
    render: (parent: Node) => void,
    renderElse?: (parent: Node) => void,
    before: Node | null = null,
): void {
    mountSwappableRange(
        parent,
        () => (condition() ? 'then' : 'else'),
        (branch) => (branch === 'then' ? render : renderElse),
        before,
    )
}
