// A TREE OF A GIVEN DEPTH, to answer the question the grid could not: a structural walk costs
// O(bindings x depth) because every binding walks from the region root, where a marker walk costs
// O(nodes) once for the whole page. Those cross somewhere, and "somewhere" is the only reason
// markers might still be the right answer for a deep template.

// `structural` is the naive emit: every binding walks from the region root. `cursor` is what
// `emitRegion` emits: one linear walk, each node found from the one before it.
//
// A THIRD ARM, `hoisted`, WAS THE EMITTED FORM UNTIL THE CURSOR REPLACED IT — each shared ancestor
// walked once by child index, the leaves indexed off it (`hoistPaths`). Measured against it in
// Chromium before it was deleted, two runs agreeing: the cursor at 0.26-0.36x on every deep shape
// and 0.33-0.34x on the wide one. The mechanism: `childNodes[i]` on a live NodeList per step
// against one `nextSibling` read per node, and a cursor that names every position is doing work a
// JIT keeps in registers.

export type Scheme = 'structural' | 'cursor' | 'markers'

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
    if (scheme === 'cursor') return cursorWalk(paths)
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

// THE CURSOR, emitted the way `emitRegion` emits it: one `const` per node the walk passes through,
// each found from the one before it (`nextSibling`) or the one it stands in (`firstChild`), with
// `?.` on every step because on a page the walk stands outside every guard. Every position is
// named, the ones between two bindings included, because that is what the emitter writes.
function cursorWalk(paths: number[][]): string {
    type Trie = Map<number, Trie>
    const root: Trie = new Map()
    for (const path of paths) {
        let at = root
        for (const step of path) {
            let next = at.get(step)
            if (next === undefined) {
                next = new Map()
                at.set(step, next)
            }
            at = next
        }
    }
    const lines: string[] = []
    const leaves = new Map<string, string>()
    let next = 0
    const visit = (node: Trie, parent: string, path: number[]): void => {
        const indices = [...node.keys()].sort((left, right) => left - right)
        let previous: string | null = null
        let position = 0
        for (const index of indices) {
            let from: string =
                previous === null
                    ? `${parent}?.firstChild`
                    : `${previous}?.nextSibling`
            for (; position < index; position += 1) {
                const passed = `c${next}`
                next += 1
                lines.push(`const ${passed} = ${from}`)
                from = `${passed}?.nextSibling`
            }
            const name = `c${next}`
            next += 1
            lines.push(`const ${name} = ${from}`)
            const child = node.get(index) as Trie
            const here = [...path, index]
            if (child.size === 0) leaves.set(here.join(','), name)
            else visit(child, name, here)
            previous = name
            position = index + 1
        }
    }
    visit(root, 'root', [])
    const found: string[] = []
    for (let at = 0; at < paths.length; at += 1)
        found.push(
            `found[${at}] = ${leaves.get((paths[at] as number[]).join(','))}`,
        )
    return `
const root = document.querySelector('#r')
${lines.join('\n')}
const found = []
${found.join('\n')}
globalThis.__SLOTS__ = found
`
}
