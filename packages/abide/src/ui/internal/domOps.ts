// THE DOM PRIMITIVES the runtime and the hydration cursor both build on — insert/remove, the sibling
// walk, and the `<template>` clone.
//
// Its own module because `hydrateCursor.ts` needs `remove` and `runtime.ts` needs all of it; leaving
// them in `runtime.ts` would make the cursor import back into the module that imports it. A layer
// under both is the honest shape: nothing here knows about slots, blocks, reactivity or hydration.

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function insert(target: Node, node: Node, anchor: Node | null): void {
    if (anchor !== null) target.insertBefore(node, anchor)
    else target.appendChild(node)
}

export function remove(node: Node): void {
    const parent = node.parentNode
    if (parent !== null) parent.removeChild(node)
}

// Cursor helpers (dual-mode-ready). PR1 only uses the clone path via `template` + `finalize`.

export function template(html: string): HTMLTemplateElement {
    const node = document.createElement('template')
    node.innerHTML = html
    return node
}

// Null-tolerant by design: a desynced clone/hydrate walk can chain these past the end of a subtree.
// Returning null (rather than throwing on a null receiver) lets the walk finish with null node vars —
// the enclosing block/root recovers (hydrate) or the last-resort fresh mount proceeds — instead of a
// hard `TypeError` that would escape recovery and leave a dead page.
export function firstChild(node: Node | null): Node | null {
    return node === null ? null : node.firstChild
}

export function nextSibling(node: Node | null): Node | null {
    return node === null ? null : node.nextSibling
}

// Move every child of `fragment` into `parent` before `anchor`, preserving order.
//
// Inserting the FRAGMENT is one DOM operation that moves all of its children at once, rather than one
// insertion per child — the same end state for a third of the work on a typical item body. The caller
// (`emitClient`) snapshots `$roots` from `fragment.childNodes` BEFORE calling this, precisely because
// the fragment is emptied here; that ordering is what makes the single-call form safe.
export function finalize(fragment: Node, parent: Node, anchor: Node | null): void {
    insert(parent, fragment, anchor)
}
