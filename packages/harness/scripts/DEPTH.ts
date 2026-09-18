// A TREE OF A GIVEN DEPTH, to answer the question the grid could not: a structural walk costs
// O(bindings x depth) because every binding walks from the region root, where a marker walk costs
// O(nodes) once for the whole page. Those cross somewhere, and "somewhere" is the only reason
// markers might still be the right answer for a deep template.

// `structural` is the naive emit: every binding walks from the region root.
// `hoisted` walks each shared ancestor ONCE and indexes the leaves off it, which is what a
// compiler can do because it knows every path at build time.
export type Scheme = 'structural' | 'hoisted' | 'markers'

export type Tree = {
    markup: string
    script: string
    bindings: number
    depth: number
}

// `leaves` slots, each `depth` elements below the root, sharing ancestors the way a real
// component tree does rather than each having a private chain.
export function tree(depth: number, leaves: number, scheme: Scheme): Tree {
    const paths: number[][] = []
    let markup = ''
    let at = 0

    // A balanced-ish tree: every level wraps the level below in one element, and the leaves sit
    // side by side at the bottom. That is the shape a nested layout makes.
    function build(level: number, count: number): string {
        if (level === 0) {
            let out = ''
            for (let i = 0; i < count; i += 1) {
                out += `<span>${scheme === 'markers' ? `<!--a${at}-->` : ''}${at}${scheme === 'markers' ? '<!--/a-->' : ''}</span>`
                at += 1
            }
            return out
        }
        return `<div class="l${level}">${build(level - 1, count)}</div>`
    }

    markup = `<main id="r">${build(depth, leaves)}</main>`

    // The path to each leaf's text: `depth` divs, then the i-th span, then its text.
    for (let i = 0; i < leaves; i += 1) {
        const path: number[] = []
        for (let d = 0; d < depth; d += 1) path.push(0)
        path.push(i, 0)
        paths.push(path)
    }

    return {
        markup,
        script: mount(scheme, paths),
        bindings: leaves,
        depth,
    }
}

function mount(scheme: Scheme, paths: number[][]): string {
    if (scheme === 'markers')
        return `
const found = []
const walker = document.createTreeWalker(document.querySelector('#r'), NodeFilter.SHOW_COMMENT)
while (true) {
    const comment = walker.nextNode()
    if (comment === null) break
    const data = comment.data
    if (data.charCodeAt(0) !== 97 || data.length === 1) continue
    found[Number(data.slice(1))] = comment.nextSibling
}
globalThis.__SLOTS__ = found
`
    if (scheme === 'hoisted') {
        // THE SHARED PREFIX IS WALKED ONCE. Every path here shares the same chain of ancestors,
        // which a compiler can see at build time, so the walk is O(depth + bindings) rather than
        // O(depth x bindings). Nothing about the DOCUMENT changes — this is purely what the
        // emitted code does with paths it already had.
        const prefix = commonPrefix(paths)
        const rest = paths.map((path) => path.slice(prefix.length))
        return `
const root = document.querySelector('#r')
let base = root
const prefix = ${JSON.stringify(prefix)}
for (let d = 0; d < prefix.length; d += 1) base = base.childNodes[prefix[d]]
const rest = ${JSON.stringify(rest)}
const found = []
for (let i = 0; i < rest.length; i += 1) {
    const path = rest[i]
    let node = base
    for (let d = 0; d < path.length; d += 1) node = node.childNodes[path[d]]
    found.push(node)
}
globalThis.__SLOTS__ = found
`
    }
    // The naive emit: one walk from the region root per binding.
    return `
const root = document.querySelector('#r')
const paths = ${JSON.stringify(paths)}
const found = []
for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i]
    let node = root
    for (let d = 0; d < path.length; d += 1) node = node.childNodes[path[d]]
    found.push(node)
}
globalThis.__SLOTS__ = found
`
}

// The longest run of indices every path begins with. A compiler computes this once, from paths it
// already holds, and emits one walk for it.
function commonPrefix(paths: number[][]): number[] {
    if (paths.length === 0) return []
    const first = paths[0] as number[]
    let length = first.length
    for (const path of paths) {
        let at = 0
        while (at < length && at < path.length && path[at] === first[at])
            at += 1
        length = at
    }
    return first.slice(0, length)
}
