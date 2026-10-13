// 16.2 AND 19.15 — EVERY HANDLER AN APP DECLARES, AND WHERE IT IS ANSWERED. A handler is an export
// of a `<script server>` in a `.abide` of the app's own, and its address is that file's
// route — its directory's (23.14) — and then the export's name. A directory's handlers may sit in as
// many of its files as an author likes; two of them exporting one name is 19.1's refusal.
//
// READ, NOT RUN. The build finds handlers by what their blocks SAY rather than by importing them,
// so a build never runs server code: a server block may open a database at import, and nothing
// about building a browser bundle is a reason to. The checker the build already holds lists what
// the file's projection exports and which call declares each (19.15) — which is also what makes an
// export that is not a handler a refusal here rather than an address that silently never answers.

import type { Mount } from '#server/answerRpc.ts'
import { refuseFrameworkRoute } from '#server/appTree.ts'
import { surfaceName } from '#server/surfaceOf.ts'
import { parseRoutePattern, placeOf, routeOf } from '#shared/routePattern.ts'
import { declaredExports } from './declaredExports.ts'
import type { AbideFile } from './parseAbide.ts'
import type { Diagnosis, TypeSession } from './TypeSession.ts'

/** A `.abide` the build read, by its path and its path below the app's root. */
type Source = {
    path: string
    relative: string
    /** 23.19 — the path it answers by: its own, or the one its mount gives it. */
    position: string
    file: AbideFile
}

const TRANSPILER = new Bun.Transpiler({ loader: 'ts' })

// 19.22 — as the transpiler prints it, one statement to a line; `export * as name` names its export.
const STAR_EXPORT = /^export \* from /m

/**
 * The app's handler mounts, with the warnings the build raised reading them.
 *
 * Off one read of the checker. 18.15 — with what the build could not read of a copy's options.
 * 19.1's one owner per route and method is `compileApp`'s, which holds the pages as well.
 */
export async function handlersUnder(
    session: TypeSession,
    sources: readonly Source[],
): Promise<{ mounts: Mount[]; warnings: Diagnosis[] }> {
    // 34.31 — a dependency's server block has no address of its own: what it declares is mounted
    // where a file of the app's re-exports it, and as that file's.
    const serving: Source[] = []
    for (const source of sources) {
        if (source.file.servers.length === 0) continue
        if (
            STAR_EXPORT.test(
                TRANSPILER.transformSync(source.file.servers.join('\n')),
            )
        )
            throw new Error(
                `abide: ${source.relative} re-exports with \`export *\` from its <script server>, whose names the build cannot read without running it. Name each handler it re-exports. RULEBOOK 19.22.`,
            )
        if (placeOf(source.position) !== 'dependency') serving.push(source)
    }
    const project = await session.project()
    const declared =
        project === undefined || serving.length === 0
            ? []
            : await declaredExports(
                  project,
                  session.tsconfig,
                  serving.map((source) => session.projectionOf(source.path)),
              )
    const mounts: Mount[] = []
    const warnings: Diagnosis[] = []
    const names = new Map<string, string>()
    for (let at = 0; at < serving.length; at += 1) {
        const { relative, position, file } = serving[at] as Source
        const route = routeOf(position)
        // 19.15 — what THE SERVER BLOCK exports, out of everything the file's module does: its
        // component and its `<script module>`'s names are the module's own.
        const exported = new Set(
            TRANSPILER.scan(file.servers.join('\n')).exports,
        )
        for (const {
            name,
            method,
            ui,
            cli,
            mcp,
            description,
            copy,
            defaults,
            args,
            unread,
        } of declared[at] ?? []) {
            if (!exported.has(name)) continue
            if (method === undefined)
                throw new Error(
                    `abide: ${relative} exports \`${name}\` from its <script server>, which is not declared as a handler. A server block exports handlers alone, each declared by abide's \`GET(…)\` (or POST, PUT, PATCH, DELETE); anything else belongs in a module of its own. RULEBOOK 19.15.`,
                )
            const address = `${route === '/' ? '' : route}/${name}`
            refuseFrameworkRoute(address, relative)
            refuseUndeclaredParameters(address, args, relative, name)
            // 20.13 — one name per handler on every generated surface.
            const surface = surfaceName(method, address)
            const named = names.get(surface)
            if (named !== undefined)
                throw new Error(
                    `abide: ${named} and ${relative} are both named ${surface} on the generated surfaces. RULEBOOK 20.13.`,
                )
            names.set(surface, relative)
            mounts.push({
                address,
                method,
                source: relative,
                name,
                ui,
                cli,
                mcp,
                description,
                copy,
                defaults,
                args,
            })
            warnings.push(...unread)
        }
    }
    return { mounts, warnings }
}

/**
 * Throws where a handler's `Args` does not declare a parameter its route carries.
 *
 * 16.67 — read off the JSON Schema its annotation derives, which is what the wire holds the args
 * to: a parameter the schema does not name would reach the handler as a key it never typed.
 */
function refuseUndeclaredParameters(
    address: string,
    args: unknown,
    source: string,
    exported: string,
): void {
    const schema = args as
        | {
              properties?: Record<string, unknown>
              additionalProperties?: unknown
          }
        | undefined
    // A record type — an index signature — declares every key.
    const open =
        schema?.additionalProperties !== undefined &&
        schema.additionalProperties !== false
    for (const segment of parseRoutePattern(address)) {
        if (segment.kind === 'static' || open) continue
        if (
            schema?.properties !== undefined &&
            segment.name in schema.properties
        )
            continue
        throw new Error(
            `abide: ${source}'s \`${exported}\` answers at ${address}, and its args do not declare \`${segment.name}\`. RULEBOOK 16.67.`,
        )
    }
}
