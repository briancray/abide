// A TREE OF A GIVEN DEPTH, to answer the question the grid could not: a structural walk costs
// O(bindings x depth) because every binding walks from the region root, where a marker walk costs
// O(nodes) once for the whole page. Those cross somewhere, and "somewhere" is the only reason
// markers might still be the right answer for a deep template.

// `structural` is the naive emit: every binding walks from the region root.
// `hoisted` walks each shared ancestor ONCE and indexes the leaves off it, which is what a
// compiler can do because it knows every path at build time.
import { hoistPaths } from '../../abide/src/compiler/hoistPaths.ts'

export type Scheme = 'structural' | 'hoisted' | 'markers'

// `hoisted` uses the compiler's OWN `hoistPaths`, so what is measured here is what is emitted —
// the prototype it replaced hoisted a single common prefix and flattered the deep shape while
// doing nothing at all for the wide one.

export type Tree = {
    markup: string
    script: string
    bindings: number
    depth: number
}

// `leaves` slots, each `depth` elements below the root, sharing ancestors the way a real
// component tree does rather than each having a private chain.
// `spread` puts the leaves under MANY distinct parents rather than one, which is the shape a
// single shared prefix cannot help: the prefix every binding shares is short, so each still walks
// its last steps alone. It is the case that would justify hoisting per subtree, and it exists so
// that question is answered rather than assumed.
export function wide(
    depth: number,
    parents: number,
    perParent: number,
    scheme: Scheme,
): Tree {
    let markup = ''
    const paths: number[][] = []
    let at = 0
    for (let p = 0; p < parents; p += 1) {
        let inner = ''
        for (let k = 0; k < perParent; k += 1) {
            inner += `<span>${scheme === 'markers' ? `<!--a${at}-->` : ''}${at}${scheme === 'markers' ? '<!--/a-->' : ''}</span>`
            const path: number[] = []
            for (let d = 0; d < depth; d += 1) path.push(d === 0 ? p : 0)
            path.push(k, 0)
            paths.push(path)
            at += 1
        }
        let wrapped = inner
        for (let d = 1; d < depth; d += 1) wrapped = `<div>${wrapped}</div>`
        markup += `<section>${wrapped}</section>`
    }
    return {
        markup: `<main id="r">${markup}</main>`,
        script: mount(scheme, paths),
        bindings: parents * perParent,
        depth,
    }
}

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
        // THE COMPILER'S OWN PLAN, emitted the way `emitClient` emits it.
        const plan = hoistPaths(paths)
        const walk =
            'const step = (n, p) => { for (let d = 0; d < p.length; d += 1) n = n.childNodes[p[d]]; return n }'
        const anchors = plan.anchors
            .map(
                (anchor) =>
                    `const ${anchor.name} = step(${anchor.from}, ${JSON.stringify(anchor.steps)})`,
            )
            .join('\n')
        const refs = paths.map((path) => plan.reference(path))
        return `
const root = document.querySelector('#r')
${walk}
${anchors}
const found = []
${refs.map((ref, i) => `found[${i}] = step(${ref.base}, ${JSON.stringify(ref.rest)})`).join('\n')}
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
