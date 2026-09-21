// WHERE A REGION'S BINDINGS START THEIR WALK. Emitting `childAt(root, wholePath)` per binding is
// O(bindings x depth), which a deep tree feels as 13x a marker walk and a WIDE one feels as 2.3x
// — measured, `depth.spec.ts`. The compiler holds every path, so the walk can be shared.
//
// ONE ANCHOR PER DISTINCT PARENT, chained. Each anchor walks from the longest anchor that is
// already a prefix of it, so a deep chain is walked once and 500 sibling subtrees each walk only
// the steps that are theirs. A single common prefix — which is what this replaced — is exactly
// right for the deep shape and does nothing at all for the wide one, where the prefix every
// binding shares is empty.

export type Hoisted = {
    // In emission order: `const <name> = childAt(<from>, <steps>)`. `path` is the whole address
    // the anchor stands at, which is what lets an emitter interleave anchors with the bindings
    // that shift them — a BLANK run before an anchor moves the index the anchor walks to.
    anchors: { name: string; from: string; path: number[]; steps: number[] }[]
    // For a binding path, the anchor to walk from and the indices left to walk.
    reference(path: number[]): { base: string; rest: number[] }
}

// `root` is what a path with no anchor above it walks from: the REGION's root, whatever that region
// is, named by the caller rather than assumed to be a page.
export function hoistPaths(paths: number[][], root = 'root'): Hoisted {
    // How many bindings sit under each proper prefix. It is counted over BINDINGS rather than
    // over their parents, because the shape that matters most has bindings with DIFFERENT parents
    // under one shared ancestor — `<p>{a}</p><p>{b}</p>` inside a `<div>` — and counting parents
    // sees three groups of one and hoists nothing.
    const sharers = new Map<string, number>()
    for (const path of paths)
        for (let length = 1; length < path.length; length += 1) {
            const key = keyOf(path.slice(0, length))
            sharers.set(key, (sharers.get(key) ?? 0) + 1)
        }

    // A prefix is worth an anchor when more than one binding is under it — and only at its
    // DEEPEST point. Where a prefix and its extension are shared by the same bindings, the
    // shorter one is a step on the way and naming it emits a line that saves nothing.
    // A count never grows down a path, so a prefix shared by the same bindings as ANY extension of
    // it is shared by them as its immediate one — one parent lookup a key, not a scan of the rest.
    const shallow = new Set<string>()
    for (const [key, count] of sharers) {
        const cut = key.lastIndexOf(',')
        if (cut === -1) continue
        const parent = key.slice(0, cut)
        if (sharers.get(parent) === count) shallow.add(parent)
    }
    const wanted: number[][] = []
    for (const [key, count] of sharers)
        if (count >= 2 && !shallow.has(key)) wanted.push(pathOf(key))

    // Shortest first, so an anchor's own prefix is always already emitted and the walks chain.
    wanted.sort((left, right) => left.length - right.length)

    const names = new Map<string, string>()
    const anchors: Hoisted['anchors'] = []
    for (const path of wanted) {
        const key = keyOf(path)
        if (names.has(key)) continue
        const from = nearest(path, names, root)
        const name = `at${anchors.length}`
        anchors.push({
            name,
            from: from.name,
            path,
            steps: path.slice(from.length),
        })
        names.set(key, name)
    }

    return {
        anchors,
        reference(path: number[]): { base: string; rest: number[] } {
            // THE ANCHOR ITSELF, where one stands at exactly this path. `nearest` answers only
            // PROPER prefixes, so an element that is both a shared parent and a binding site of
            // its own — the element carrying a listener AND a bound attribute, which is the
            // common case — walked to a node an anchor was already holding. Only an ELEMENT path
            // can match: an anchor has bindings strictly below it and a text node has no children.
            const here = names.get(keyOf(path))
            if (here !== undefined) return { base: here, rest: [] }
            const from = nearest(path, names, root)
            return { base: from.name, rest: path.slice(from.length) }
        },
    }
}

// The deepest already-named path that is a PROPER prefix of this one. `root` is the floor, and it
// is why nothing has to special-case a binding with no anchor above it.
function nearest(
    path: number[],
    names: Map<string, string>,
    root: string,
): { name: string; length: number } {
    for (let length = path.length - 1; length >= 1; length -= 1) {
        const name = names.get(keyOf(path.slice(0, length)))
        if (name !== undefined) return { name, length }
    }
    return { name: root, length: 0 }
}

function keyOf(path: number[]): string {
    return path.join(',')
}

function pathOf(key: string): number[] {
    return key === '' ? [] : key.split(',').map(Number)
}
