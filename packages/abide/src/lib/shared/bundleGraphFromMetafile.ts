import { resolve } from 'node:path'
import type { BuildMetafile } from 'bun'

/* One surviving module in the post-DCE bundle graph: its absolute path and input source byte
   size. `bytes` is the metafile's `inputs[key].bytes` — the source weight the budget diagnostic
   measures (a tree-shaken module is absent from the metafile entirely, so every module here
   SURVIVED into the bundle). */
type BundleGraphModule = {
    path: string
    bytes: number
}

/*
The post-DCE module graph reconstructed from a client build's `Bun.build` metafile — the reusable
analysis seam ADR-0031 D2 factors out. `metafile.inputs` is the DCE-accurate graph (a
textually-imported but tree-shaken module is ABSENT), so a single walk yields both the surviving
modules and their child→importer edges; consumers then judge the graph without re-walking it.
Two ride it today: the side-crossing reachability guard (a surviving server-only module is a
violation) and the bundle-budget diagnostic (a surviving input over a size budget is a warning).
The metafile carries module presence + input byte size, NOT export-level liveness — so a consumer
can judge "this module survived / is this big", not "this export is unused" (ADR-0031 D2 spike).
*/
export type BundleGraph = {
    /* Every module present in the post-DCE graph, keyed by absolute path. */
    modules: BundleGraphModule[]
    /* The import chain from a graph root down to `target`, in root→target order (absolute paths),
       reconstructed from the graph's own first-wins child→importer edges — one witness, cycle-safe.
       Returns `[target]` when nothing imports it (a graph root). */
    importerChain(target: string): string[]
}

/*
Walks a client build's metafile once into a `BundleGraph`. `inputs` keys are relative to
`process.cwd()` while edge `path`s are absolute, so each module path is resolved against `cwd` to
match on absolute paths throughout. First edge wins for the importer map — enough to render one
witness chain, and cheap.
*/
export function bundleGraphFromMetafile(metafile: BuildMetafile, cwd: string): BundleGraph {
    const modules: BundleGraphModule[] = []
    /* child(absolute) → its importer(absolute); first edge wins — one witness chain. */
    const importerOf = new Map<string, string>()
    for (const [key, input] of Object.entries(metafile.inputs)) {
        const modulePath = resolve(cwd, key)
        modules.push({ path: modulePath, bytes: input.bytes })
        for (const edge of input.imports) {
            if (!importerOf.has(edge.path)) {
                importerOf.set(edge.path, modulePath)
            }
        }
    }
    return {
        modules,
        importerChain(target) {
            const chain = [target]
            const seen = new Set([target])
            let cursor = target
            while (importerOf.has(cursor)) {
                cursor = importerOf.get(cursor) as string
                if (seen.has(cursor)) {
                    break
                }
                seen.add(cursor)
                chain.push(cursor)
            }
            return chain.reverse()
        },
    }
}
