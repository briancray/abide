// MOVING A NODE WITHOUT TAKING IT OUT OF THE DOCUMENT FIRST.
//
// `insertBefore` on a node that is already in the document is a REMOVE and then an INSERT, and it
// is the remove that costs: an `<iframe>` reloads its document, a `<video>` pauses, a CSS
// animation and a running transition restart, and focus leaves the element. `moveBefore` is the
// same reorder with the node never leaving the tree, so none of that happens.
//
// THIS IS A CORRECTNESS SWAP AND NOT A PERFORMANCE ONE, and the distinction is the reason it is
// worth writing down. `harness/measure`'s `elementsMoved` counts ONE move either way — both calls
// move exactly one node — so the count that prices every other reconcile change is blind to this
// one, and a gate built on it would be green against both arms. What separates them is an event:
// the `load` an iframe fires when it is torn out, n per reorder against 0.
//
// PROBED, NOT VERSIONED. Where `moveBefore` is absent this is exactly the call the reconcile made
// before it existed, so the fallback is today's behaviour rather than a degraded one. happy-dom
// does not implement it, which is why the gate for this belongs in the browser lane — see
// `packages/harness/e2e`.
const CAN_MOVE =
    typeof Element !== 'undefined' && 'moveBefore' in Element.prototype

// `node` MUST already be in the document under a parent — this is the SURVIVOR path, where a row
// the reconcile kept is being put back in a new order. A node with no parent is `moveBefore`'s
// one throwing case and `makeRow` is where those go, through `insertBefore`.
export function moveNode(parent: Node, node: Node, before: Node | null): void {
    if (CAN_MOVE)
        (
            parent as ParentNode & { moveBefore(n: Node, b: Node | null): void }
        ).moveBefore(node, before)
    else parent.insertBefore(node, before)
}
