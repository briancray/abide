// The HTML elements that never take children.
//
// Both halves of the compiler need the same answer and would fail differently if they disagreed: the
// parser must not wait for a closing tag that never comes, and the emitter must write `<img />`
// rather than `<img></img>`. One list, so the two cannot drift.

export const VOID_ELEMENTS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
])
