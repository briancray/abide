// The second speed: shapes for the types the scanner cannot read.
//
// `shape.ts` derives from tokens — pure, per-module, ~37 µs, and it runs in every lane including a
// browser. It reaches an inline type, a local `type`/`interface`, and (given a resolver) an imported
// one. Where it stops is where a type has to be COMPUTED: `Omit<User, 'id'>`, a conditional, a mapped
// type, an `enum`, a generic alias. Those are not a filesystem problem — resolving them is what a
// checker IS.
//
// So this runs the real checker, once, over the whole project. It is a BUILD step and it is optional:
// what it produces only ever UPGRADES a shape, and an endpoint it says nothing about keeps the one
// the compiler derived. That is the whole staleness story — a stale answer here is a shape that knows
// less, which is the direction every derived shape is already allowed to be wrong in.
//
// The work is split across two processes because it has to be. TypeScript 7's checker is the native
// `tsgo` binary behind a synchronous RPC channel that reads a Node-internal file descriptor, so it
// cannot run under Bun at all. `internal/checked.ts` is the Node half and knows nothing about abide;
// this half owns the address scheme, the directory rule and the endpoint syntax, so there is one
// place that decides what an endpoint is and it is the same one both lanes already use.

import type { Shapes } from '$shared/internal/shapes.ts'
import type { Kind } from '$shared/transport.ts'
import { endpointId, SHAPES_FILE } from './index.ts'
import { endpointsOf, TRANSPORT_GLOBS } from './internal/elide.ts'

export interface DeriveOptions {
    /** Directories to scan for transport modules. */
    roots: string[]
    /** The project the checker opens. Defaults to `tsconfig.json` beside the working directory. */
    tsconfig?: string
    cwd?: string
}

/** One endpoint the checker is asked about — its address, and where to find it. */
interface Wanted {
    id: string
    file: string
    name: string
    kind: 'rpc' | 'socket'
}

/** The directory rule, compiled once — and what a matched path's kind is read back off. */
const GLOBS: [Kind, Bun.Glob][] = [
    ['rpc', new Bun.Glob(TRANSPORT_GLOBS.rpc)],
    ['socket', new Bun.Glob(TRANSPORT_GLOBS.socket)],
]

/**
 * Every transport module under `roots`, and the endpoints each declares.
 *
 * Through `endpointsOf`, so "what is an endpoint" is answered once in the repo. A module that does
 * not compile is skipped rather than fatal: this is an enrichment pass, and the lane that must fail
 * on a broken transport module is the one that loads it.
 */
async function wanted(roots: string[]): Promise<Wanted[]> {
    // Every path first, then every read AT ONCE. Awaiting each `text()` inside the scan put N file
    // opens end to end with nothing else in flight, and the scan itself is metadata — the reads are
    // the whole latency of this step. The kind comes off the glob that matched, so the directory
    // rule is not restated here to recover it.
    const files: { path: string; kind: Kind }[] = []
    for (const root of roots) {
        for (const [kind, glob] of GLOBS) {
            for await (const path of glob.scan({ cwd: root, absolute: true })) files.push({ path, kind })
        }
    }
    const texts = await Promise.all(
        files.map((file) =>
            Bun.file(file.path)
                .text()
                .catch(() => null),
        ),
    )

    const found: Wanted[] = []
    for (let i = 0; i < files.length; i++) {
        const text = texts[i]
        if (text === undefined || text === null) continue
        const file = files[i] as { path: string; kind: Kind }
        let endpoints: ReturnType<typeof endpointsOf>
        try {
            endpoints = endpointsOf(text, file.path, file.kind)
        } catch {
            continue
        }
        for (const endpoint of endpoints) {
            found.push({
                id: endpointId(file.path, endpoint.name),
                file: file.path,
                name: endpoint.name,
                kind: file.kind,
            })
        }
    }
    return found
}

/**
 * The shapes the checker can see, by endpoint address.
 *
 * Empty when there is nothing to ask about, which is "no upgrade" and not a reason for a build to
 * stop. A checker that FAILS throws, and so does a missing `node` — this pass is optional to run and
 * not optional to complete, so a caller that would rather degrade than fail catches it.
 */
export async function deriveShapes(options: DeriveOptions): Promise<Record<string, Shapes>> {
    const endpoints = await wanted(options.roots)
    if (endpoints.length === 0) return {}
    const cwd = options.cwd ?? process.cwd()
    const job = {
        cwd,
        tsconfig: options.tsconfig ?? `${cwd}/tsconfig.json`,
        endpoints,
    }
    // Spawned rather than imported, and NODE rather than Bun: see the header. The child is handed the
    // job on stdin so a project with hundreds of endpoints does not have to fit in an argument list.
    const child = Bun.spawn(['node', new URL('internal/checked.ts', import.meta.url).pathname], {
        cwd,
        stdin: new TextEncoder().encode(JSON.stringify(job)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [out, error] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ])
    if ((await child.exited) !== 0) {
        throw new Error(`abide: the checker could not derive shapes — ${error.trim() || 'no output'}`)
    }
    return JSON.parse(out) as Record<string, Shapes>
}

if (import.meta.main) {
    // Parsed rather than filtered: the value after `--out` is a PATH, and a filter that only skips
    // arguments starting with `-` hands it to the scanner as a directory to look for endpoints in.
    const argv = Bun.argv.slice(2)
    const roots: string[] = []
    let out: string | null = null
    let pretty = false
    for (let i = 0; i < argv.length; i++) {
        const argument = argv[i] as string
        if (argument === '--out') {
            out = argv[++i] ?? SHAPES_FILE
            continue
        }
        if (argument === '--pretty') {
            pretty = true
            continue
        }
        if (!argument.startsWith('-')) roots.push(argument)
    }
    const shapes = await deriveShapes({ roots: roots.length > 0 ? roots : ['.'] })
    const text = JSON.stringify(shapes, null, pretty ? 1 : 0)
    if (out === null) console.log(text)
    else await Bun.write(out, `${text}\n`)
}
