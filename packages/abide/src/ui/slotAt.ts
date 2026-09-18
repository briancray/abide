// One slot, or a refusal that says which one. A binding reaching a slot the document does not
// carry is a hydration mismatch (41.11) and not a thing to write through: `undefined is not an
// object (evaluating 'node.data')` names neither the slot nor the page it is on, and that is what
// this replaces.
export function slotAt(slots: Text[], at: number): Text {
    const node = slots[at]
    if (node === undefined)
        throw new Error(
            `abide: slot ${at} is not in the rendered document, so the client and the server disagree about this region's shape (41.11).`,
        )
    return node
}
