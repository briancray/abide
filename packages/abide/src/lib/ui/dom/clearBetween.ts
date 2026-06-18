/*
Tears down a control-flow range: disposes its reactive scope, then removes every
node between the `start` and `end` markers (exclusive). Walking between the markers
at clear time — rather than tracking a captured node list — is what lets a branch
hold dynamic nested blocks: nodes a nested block inserted after the initial build
still sit between the markers, so they're removed too.
*/
export function clearBetween(start: Node, end: Node, dispose?: () => void): void {
    dispose?.()
    let node = start.nextSibling
    while (node !== null && node !== end) {
        const next = node.nextSibling
        end.parentNode?.removeChild(node)
        node = next
    }
}
