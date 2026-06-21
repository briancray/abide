/* A comment node's data, or undefined for elements/text. A comment is a node that is
   neither an element (`hasAttribute`) nor a text node (`splitText`); the mini-dom
   exposes no `nodeType`, so detect by method. Shared by every marker-range scan
   (`skeleton`'s anchor walk, `outlet`'s close-marker skip) so the convention is probed
   one way everywhere. */
export function commentData(node: Node): string | undefined {
    if (
        typeof (node as Element).hasAttribute === 'function' ||
        typeof (node as Text).splitText === 'function'
    ) {
        return undefined
    }
    return (node as Comment).data
}
