/** A sort's comparison of two nodes by where they stand in the document: `-1` where `one` is first. */
export function byDocumentOrder(one: Node, other: Node): number {
    return one.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1
}
