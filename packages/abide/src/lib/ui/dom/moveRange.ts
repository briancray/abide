/*
Moves a contiguous node range — `start` through `end` inclusive — to sit just
before `ref`, preserving order. Each node's next sibling is captured before the
move (insertBefore relocates it, changing `nextSibling`). Used by the keyed `each`
to reposition a row whose content is a range rather than a single node.
*/
export function moveRange(start: Node, end: Node, ref: Node | null): void {
    const parent = ref?.parentNode ?? end.parentNode
    if (parent === null) {
        return
    }
    let node: Node | null = start
    const stop: Node | null = end.nextSibling
    while (node !== null && node !== stop) {
        const next: Node | null = node.nextSibling
        parent.insertBefore(node, ref)
        node = next
    }
}
