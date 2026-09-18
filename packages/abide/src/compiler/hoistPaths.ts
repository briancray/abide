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
    // In emission order: `const <name> = childAt(<from>, <steps>)`.
    anchors: { name: string; from: string; steps: number[] }[]
    // For a binding path, the anchor to walk from and the indices left to walk.
    reference(path: number[]): { base: string; rest: number[] }
}

const ROOT = 'root'

export function hoistPaths(paths: number[][]): Hoisted {
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
    const wanted: number[][] = []
    for (const [key, count] of sharers) {
        if (count < 2) continue
        const path = pathOf(key)
        let deepest = true
        for (const [otherKey, otherCount] of sharers) {
            if (otherCount !== count || otherKey.length <= key.length) continue
            if (otherKey.startsWith(`${key},`)) {
                deepest = false
                break
            }
        }
        if (deepest) wanted.push(path)
    }

    // Shortest first, so an anchor's own prefix is always already emitted and the walks chain.
    wanted.sort((left, right) => left.length - right.length)

    const names = new Map<string, string>()
    const anchors: Hoisted['anchors'] = []
    for (const path of wanted) {
        const key = keyOf(path)
        if (names.has(key)) continue
        const from = nearest(path, names)
        const name = `at${anchors.length}`
        anchors.push({ name, from: from.name, steps: path.slice(from.length) })
        names.set(key, name)
    }

    return {
        anchors,
        reference(path: number[]): { base: string; rest: number[] } {
            const from = nearest(path, names)
            return { base: from.name, rest: path.slice(from.length) }
        },
    }
}

// The deepest already-named path that is a PROPER prefix of this one. `root` is the floor, and it
// is why nothing has to special-case a binding with no anchor above it.
function nearest(
    path: number[],
    names: Map<string, string>,
): { name: string; length: number } {
    for (let length = path.length - 1; length >= 1; length -= 1) {
        const name = names.get(keyOf(path.slice(0, length)))
        if (name !== undefined) return { name, length }
    }
    return { name: ROOT, length: 0 }
}

function keyOf(path: number[]): string {
    return path.join(',')
}

function pathOf(key: string): number[] {
    return key === '' ? [] : key.split(',').map(Number)
}
