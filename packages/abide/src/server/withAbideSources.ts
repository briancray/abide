import { relative, resolve } from 'node:path' // bun exposes no path helpers of its own

import type { Compilation } from './abideModules.ts'
import { COMPONENT_NAMESPACE } from './faceOf.ts'
import { COMPONENT_QUERY } from './MODULE_QUERIES.ts'
import {
    decodeMappings,
    encodeMappings,
    placeAt,
    type Segment,
} from './sourceMappings.ts'

const NAMESPACED = `${COMPONENT_NAMESPACE}:`

// THE PARSER IS IMPORTED ON THE FIRST MAP ASKED FOR, not with the dev worker each reload boots:
// only a debugger reads one.
let parser: Promise<typeof import('#compiler/parseAbide.ts')> | undefined

/**
 * 38.97 — a client chunk's source map, with every position in a module compiled from a `.abide`
 * placed in the `.abide` instead.
 *
 * Bun maps the chunk to the modules it bundled and reads no map those carry, so the second step is
 * taken here. A position in the module's own scaffolding — what no `.abide` line wrote — stays in
 * the compiled module, which is still listed, so a debugger steps through it rather than losing it.
 */
export async function withAbideSources(
    mapText: string,
    compilation: Compilation,
    root: string,
): Promise<string> {
    const map = JSON.parse(mapText) as {
        sources: string[]
        sourcesContent?: (string | null)[]
        mappings: string
    }
    const sources = map.sources
    const contents = map.sourcesContent ?? []
    // Per bundled source, its module's map and the index its `.abide` is listed at.
    const placed: ({ lines: Segment[][]; index: number } | undefined)[] = []
    const listed = new Map<string, number>()
    const reads: Promise<void>[] = []
    const originals = sources.length
    for (let index = 0; index < originals; index += 1) {
        // Bun names a bundled source from where the command runs, and a component module — which
        // the plugin served at its `.abide`'s path — by its namespace and that path.
        const named = sources[index] as string
        const component = named.startsWith(NAMESPACED)
        const abide = resolve(
            component ? named.slice(NAMESPACED.length) : named,
        )
        const mappings = component
            ? compilation.files[relative(root, abide)]?.clientMappings
            : undefined
        if (mappings === undefined) {
            placed.push(undefined)
            continue
        }
        // The module bun bundled is named apart from the `.abide` it is placed in, which shares
        // its path.
        sources[index] = `${relative(process.cwd(), abide)}${COMPONENT_QUERY}`
        let at = listed.get(abide)
        if (at === undefined) {
            at = sources.length
            listed.set(abide, at)
            // Named as bun names its own, from where the command runs; read from where it is.
            sources.push(relative(process.cwd(), abide))
            const slot = at
            parser ??= import('#compiler/parseAbide.ts')
            reads.push(
                Promise.all([Bun.file(abide).text(), parser]).then(
                    ([text, { parseAbide }]) => {
                        contents[slot] = withoutServerBlocks(text, parseAbide)
                    },
                ),
            )
        }
        placed.push({ lines: decodeMappings(mappings), index: at })
    }
    if (listed.size === 0) return mapText
    await Promise.all(reads)
    for (let index = contents.length; index < sources.length; index += 1)
        contents[index] ??= null
    const lines = decodeMappings(map.mappings)
    for (const segments of lines)
        for (const segment of segments) {
            const module = placed[segment[1]]
            if (module === undefined) continue
            const from = placeAt(module.lines, segment[2], segment[3])
            if (from === undefined) continue
            segment[1] = module.index
            segment[2] = from[0]
            segment[3] = from[1]
        }
    map.sourcesContent = contents
    map.mappings = encodeMappings(lines)
    return JSON.stringify(map)
}

/**
 * 16.28, 34.19 — the `.abide`'s text with every `<script server>` body blanked: the map is served
 * to a browser, which reads none of one. Each line is kept, so every line the map places is still
 * the line it names.
 */
function withoutServerBlocks(
    text: string,
    parseAbide: typeof import('#compiler/parseAbide.ts').parseAbide,
): string {
    const file = parseAbide(text)
    let blanked = ''
    let at = 0
    for (let index = 0; index < file.servers.length; index += 1) {
        const start = file.origins.servers[index] as number
        const end = start + (file.servers[index] as string).length
        blanked += `${text.slice(at, start)}${text.slice(start, end).replace(/[^\n]/g, '')}`
        at = end
    }
    return blanked + text.slice(at)
}
