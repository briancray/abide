// Elements that never have children and never take a close tag. A constants leaf, with no imports
// of its own: the PARSER must not push one onto its open-element stack and the EMITTER must not
// write a close tag for one, and two copies of the list is one list that goes stale.
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
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
    'source',
    'track',
    'wbr',
])
