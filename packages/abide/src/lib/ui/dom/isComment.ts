/* A comment node carrying exactly `data`. Empty-child check distinguishes the
   `<!--data-->` marker from an element that happens to expose a `data` property.
   Shared by the marker-range scanners in appendText. */
export function isComment(node: Node, data: string): boolean {
    return (node as { data?: string }).data === data && node.childNodes.length === 0
}
