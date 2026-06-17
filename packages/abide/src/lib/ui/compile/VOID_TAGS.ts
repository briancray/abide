/*
HTML void elements — they have no closing tag and no children. Shared by the SSR
generator and the static-clone skeleton generator so both emit `<img>` not
`<img></img>`, keeping server markup and the client clone template identical.
*/
export const VOID_TAGS: ReadonlySet<string> = new Set([
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
