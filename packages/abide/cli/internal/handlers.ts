// Every transport module in the project, imported — which is the whole of how an endpoint is served.
//
// A handler is reachable exactly when its module has been imported: the compiler appends a
// `register(…)` to every module under `server/rpc/**` and `server/sockets/**`, and that call is what
// puts the address in the registry. So SOMETHING has to import them, and until now that something was
// the app — a file of `import './server/rpc/users.ts'` lines, kept in step by hand, whose failure mode
// is a 404 on an endpoint that is right there in the tree.
//
// It is the boot's job instead, because the rule is already written down: the DIRECTORY is the kind.
// A file under `server/rpc/` is an rpc by virtue of where it sits, which is the same fact the
// compiler reads to elide it, the shapes pass reads to check it, and the address in the URL is built
// from. Something that is decided by a path can be found by a scan, and an app should not have to
// restate it as a list of imports.
//
// The globs come from the compiler rather than being written again here. A scanner that missed a
// renamed directory would find nothing and say nothing, and "no endpoints" is indistinguishable from
// "no endpoints registered yet" at exactly the moment it matters. The ANCHORED spelling, because this
// one imports what it finds: a fixture in some other `server/rpc/` under the tree is not an endpoint
// of this app, and its address would be cut from the same directory name as the real one.

import { TRANSPORT_ROOTS } from '$compiler/internal/elide.ts'

/**
 * Import every handler under `root`. The registry is the answer — that is what an import is FOR here.
 *
 * Sorted, so two boots of one tree register in one order — the addresses are a Map's keys, and a
 * `/__abide/schema` document that reshuffled between deploys would be a diff of nothing.
 *
 * A module that throws is NOT swallowed: a broken endpoint file is a broken app, and the boot that
 * finds out is the one that can still refuse to listen. That is the opposite of the shapes pass,
 * which skips what it cannot read — it is an enrichment, and this is the app.
 *
 * How many were FOUND is the return, because the registry cannot answer the question the caller has:
 * a command registers endpoints of its own — `abide dev`'s reload socket is one — so a count taken
 * from the registry says "this app has endpoints" about a directory that has none.
 */
export async function handlers(root: string): Promise<number> {
    const found: string[] = []
    for (const pattern of Object.values(TRANSPORT_ROOTS)) {
        const glob = new Bun.Glob(pattern)
        for await (const path of glob.scan({ cwd: root, absolute: true, onlyFiles: true })) {
            // A declaration is not a module. An app may keep its own `.d.ts`, and importing one is a
            // runtime error about a file that exists only for the checker.
            if (path.endsWith('.d.ts')) continue
            found.push(path)
        }
    }
    found.sort()
    // In series, deliberately. These modules are the app's own graph — a database pool, a rate
    // limiter, a client for something else — and their module bodies run here. Two of them opening
    // the same resource concurrently is a race an app never wrote, in an order it cannot see.
    for (const path of found) await import(Bun.pathToFileURL(path).href)
    return found.length
}
