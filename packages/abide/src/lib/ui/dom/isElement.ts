/* An element carries `hasAttribute`; comment/text nodes do not. Detected by method (not
   `nodeType`) so every skeleton walk runs under the test mini-dom too. Shared by the
   element-hole path resolver (`skeleton`) and both realized-DOM walk adapters. */
export function isElement(node: Node): node is Element {
    return typeof (node as Element).hasAttribute === 'function'
}
