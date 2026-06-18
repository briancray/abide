/*
Removes a contiguous node range — `start` through `end` inclusive — from the DOM.
Used to evict a departed keyed-`each` row whose content is a range (markers plus
whatever they bound). Each next sibling is captured before removal.
*/
export function removeRange(start: Node, end: Node): void {
    const parent = end.parentNode
    if (parent === null) {
        return
    }
    let node: Node | null = start
    const stop: Node | null = end.nextSibling
    while (node !== null && node !== stop) {
        const next: Node | null = node.nextSibling
        parent.removeChild(node)
        node = next
    }
}
