// 23.26, 23.27 — WHICH MATCHER EACH SEGMENT NAMES, resolved once at build and carried into the route
// tables as text, so nothing at run time looks a name up. A segment's `=NAME` is the param file
// `NAME.param.ts` in the directory holding that segment or the nearest one above it, below the root
// the file is filed under: the app's root for the app's own, and a mounted directory for the files
// under it (23.19), so a host's matcher never decides a mounted package's segment.
//
// ONE MATCHER PER POSITION across every file filed there (23.27): a layout, a page and a handler
// directory at `/holdings/[symbol=TICKER]` share the segment, and a page that took `BRK.B` under a
// layout whose segment refused it would be wrapped by a layout no address of its own reaches.

import { parseRoutePattern } from '#shared/routePattern.ts'
import { matcherOf } from './paramFile.ts'
import type { Refusals } from './Refusals.ts'

/** A directory a file mounts (23.19), where it mounts, and the param files under it, by path. */
export type MountedTree = { directory: string; at: string; params: string[] }

/** A file with a route: its path, the name refusals give it, and the position it answers by. */
type Routed = { path: string; relative: string; position: string; route: string }

/**
 * Each routed file's matchers, by its path: every name its route's segments give, to the anchored
 * source of the param file it resolves to — empty where its route names none.
 *
 * `params` is every param file of the app's own, by path. Refusals land at the file the fault is in:
 * a param file that declares no matcher at itself, a name that resolves to none at the segment's file.
 */
export async function matchersOf(
    root: string,
    routed: readonly Routed[],
    params: readonly string[],
    trees: readonly MountedTree[],
    refusals: Refusals,
): Promise<Map<string, Record<string, string>>> {
    // Every param file's matcher, read once whichever routes name it; `undefined` where 23.24 or
    // 23.25 refused the file, so a segment naming it refuses nothing more.
    const sources = new Map<string, string | undefined>()
    const all = [...params]
    for (const tree of trees) all.push(...tree.params)
    for (const path of all) {
        if (sources.has(path)) continue
        const matcher = matcherOf(labelOf(root, path), await Bun.file(path).text())
        if (matcher instanceof Error) {
            refusals.at(path, matcher)
            sources.set(path, undefined)
        } else sources.set(path, matcher)
    }
    const byPath = new Map<string, Record<string, string>>()
    // 23.27 — what each parameter position resolved to, and the first file that said so.
    const atPosition = new Map<string, { found: string; file: string }>()
    for (const file of routed) {
        const matchers: Record<string, string> = {}
        const tree = treeOf(file.path, trees)
        const positionParts = file.position.split('/')
        let shape = ''
        let at = 0
        for (const segment of parseRoutePattern(file.route)) {
            shape += `/${segment.kind === 'static' ? segment.name : `[${segment.kind}]`}`
            const index = at
            at += 1
            if (segment.kind === 'static') continue
            const found =
                segment.matcher === undefined
                    ? ''
                    : nearestParam(
                          root,
                          tree,
                          positionParts.slice(0, index),
                          segment.matcher,
                          sources,
                      )
            if (found === undefined) {
                refusals.at(
                    file.path,
                    new Error(
                        `abide: ${file.relative} names the matcher ${segment.matcher}, and no ${segment.matcher}.param.ts is in the directory holding that segment or any directory above it. RULEBOOK 23.26.`,
                    ),
                )
                continue
            }
            const other = atPosition.get(shape)
            if (other === undefined) atPosition.set(shape, { found, file: file.relative })
            else if (other.found !== found)
                refusals.at(
                    file.path,
                    new Error(
                        `abide: ${other.file} and ${file.relative} decide the parameter at ${shape} by ${describe(root, other.found)} and by ${describe(root, found)}, and one position takes one matcher. RULEBOOK 23.27.`,
                    ),
                )
            const source = found === '' ? undefined : sources.get(found)
            if (segment.matcher !== undefined && source !== undefined)
                matchers[segment.matcher] = source
        }
        byPath.set(file.path, matchers)
    }
    return byPath
}

/**
 * The param file `NAME.param.ts` a segment at `holding` names, nearest first, or `undefined`.
 *
 * `holding` is the position of the directory holding the segment, and the walk stops at the root
 * the segment is filed under: inside a mounted directory, that directory; a segment of the position
 * the mount itself takes is the mounting app's.
 */
function nearestParam(
    root: string,
    tree: MountedTree | undefined,
    holding: string[],
    name: string,
    sources: Map<string, string | undefined>,
): string | undefined {
    const atParts = tree === undefined ? 0 : tree.at.split('/').length - 1
    const inside = tree !== undefined && holding.length >= atParts
    const base = inside ? tree.directory : root
    const below = inside ? holding.slice(atParts) : holding
    for (let depth = below.length; depth >= 0; depth -= 1) {
        const directory = [base, ...below.slice(0, depth)].join('/')
        const candidate = `${directory}/${name}.param.ts`
        if (sources.has(candidate)) return candidate
    }
    return undefined
}

/** The mounted directory `path` lies in, the deepest where two nest, or `undefined` for the app's own. */
function treeOf(
    path: string,
    trees: readonly MountedTree[],
): MountedTree | undefined {
    let deepest: MountedTree | undefined
    for (const tree of trees)
        if (
            path.startsWith(`${tree.directory}/`) &&
            (deepest === undefined ||
                tree.directory.length > deepest.directory.length)
        )
            deepest = tree
    return deepest
}

function labelOf(root: string, path: string): string {
    return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function describe(root: string, found: string): string {
    return found === '' ? 'no matcher' : labelOf(root, found)
}
