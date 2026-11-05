// 16.2 AND 16.70 — EVERY HANDLER AN APP DECLARES, AND WHERE IT IS ANSWERED. A handler file's default
// export answers at that file's route (23.14), and is the app's public surface; a handler a
// `<script server>` declares is its file's alone, answered below `/__abide/handlers/` at the file's
// path and its binding's name, and listed nowhere (16.71).
//
// READ, NOT RUN. The build finds handlers by what their files SAY rather than by importing them,
// so a build never runs server code: a handler file may open a database at import, and nothing
// about building a browser bundle is a reason to. The checker the build already holds lists what
// each module exports and which call declares each (16.73) — which is also what makes an export
// that is not a handler a refusal here rather than an address that silently never answers.

import { frameworkRouteRefusal } from '#server/appTree.ts'
import { handlerFileMount } from '#server/handlerFileMount.ts'
import type { Mount } from '#server/mountHandlers.ts'
import { PRIVATE_EXPORT } from '#server/PRIVATE_EXPORT.ts'
import { surfaceName } from '#server/surfaceOf.ts'
import { PRIVATE_HANDLERS_ADDRESS } from '#shared/ADDRESSES.ts'
import { parseRoutePattern } from '#shared/routePattern.ts'

import type { PlacedHandler, PlacedSource } from './appLayout.ts'
import { declaredExports } from './declaredExports.ts'
import type { Diagnostics } from './Diagnostics.ts'
import type { TypeSession } from './TypeSession.ts'

/** A handler file, by its path and its path below the app's root. */
export type HandlerFile = {
    path: string
    relative: string
    /** 23.19 — the path it answers by: its own, or the one its mount gives it. */
    position: string
}

/** A `.abide` the build read, placed. */
type Source = Pick<
    PlacedSource,
    'path' | 'relative' | 'position' | 'place' | 'scope' | 'file'
>

/**
 * The app's handler mounts, the warnings the build raised reading them kept in `diagnostics`.
 *
 * Off one read of the checker. 18.15 — with what the build could not read of a copy's options.
 * 19.1's one owner per route and method is `compileApp`'s, which holds the pages as well.
 */
export async function handlersUnder(
    session: TypeSession,
    sources: readonly Source[],
    files: readonly Pick<
        PlacedHandler,
        'path' | 'relative' | 'route' | 'scope' | 'matchers'
    >[],
    diagnostics: Diagnostics,
): Promise<Mount[]> {
    const serving: Source[] = []
    for (const source of sources)
        if (source.file.servers.length > 0) serving.push(source)
    const host = session.host
    const modules: { path: string; file: string; onDisk: boolean }[] = []
    for (const file of files)
        modules.push({ path: file.path, file: file.relative, onDisk: true })
    for (const source of serving)
        modules.push({
            path: host.projectionOf(source.path),
            file: source.path,
            onDisk: false,
        })
    // A module whose read was refused is `undefined`, refused at its file already.
    const declared = await declaredExports(host, modules, diagnostics)
    const mounts: Mount[] = []
    const names = new Map<string, string>()
    for (const { path, relative, route: address, scope, matchers } of files) {
        const exported = declared.get(path)
        if (exported === undefined) continue
        try {
            const handler = exported.find((each) => each.name === 'default')
            // 16.73 — the default and nothing else, declared by one of the five methods.
            for (const each of exported)
                if (each.name !== 'default' || each.method === undefined)
                    throw new Error(
                        each.name === 'default'
                            ? `abide: ${relative}'s default export is not declared as a handler. A handler file's default is declared by abide's \`GET(…)\` (or POST, PUT, PATCH, DELETE); anything else belongs under a lib directory. RULEBOOK 16.73.`
                            : `abide: ${relative} exports \`${each.name}\`, and a handler file exports its handler as its default and nothing else. Move \`${each.name}\` into a module under a lib directory. RULEBOOK 16.73.`,
                    )
            if (handler?.method === undefined)
                throw new Error(
                    `abide: ${relative} is a handler file — a <name>.handler.ts directly in an address directory — and exports no handler as its default. Export one (\`export default GET(…)\`), or move the file into a lib directory. RULEBOOK 16.73, 23.22.`,
                )
            const framework = frameworkRouteRefusal(address, relative)
            if (framework !== undefined) throw framework
            refuseUndeclaredParameters(address, handler.args, relative)
            // 20.13 — one name per handler on every generated surface.
            const surface = surfaceName(handler.method, address)
            const named = names.get(surface)
            if (named !== undefined)
                throw new Error(
                    `abide: ${named} and ${relative} are both named ${surface} on the generated surfaces. RULEBOOK 20.13.`,
                )
            names.set(surface, relative)
            mounts.push(
                handlerFileMount(
                    { address, source: relative, scope, matchers },
                    { ...handler, method: handler.method },
                ),
            )
            diagnostics.warn(handler.unread)
        } catch (thrown) {
            diagnostics.at(relative, thrown)
        }
    }
    for (const { path, relative, position, place, scope } of serving) {
        // 34.24 — a dependency's file answers where a mount places it, and its handlers below the
        // path it has there.
        const below = place === 'dependency' ? relative : position
        for (const each of declared.get(host.projectionOf(path)) ?? []) {
            if (each.method === undefined) continue
            if (!each.name.startsWith(PRIVATE_EXPORT)) continue
            const name = each.name.slice(PRIVATE_EXPORT.length)
            mounts.push({
                address: privateAddress(below, name),
                method: each.method,
                source: relative,
                name,
                export: each.name,
                scope,
                matchers: {},
                private: true,
                ui: each.ui,
                cli: false,
                mcp: false,
                description: each.description,
                copy: each.copy,
                defaults: each.defaults,
                args: each.args,
                result: each.result,
            })
            diagnostics.warn(each.unread)
        }
    }
    return mounts
}

/**
 * The address of the private handler `name` the `.abide` at `path` declares: below
 * `PRIVATE_HANDLERS_ADDRESS`, the file's path without its extension, each segment's brackets and
 * dots dropped so nothing in it reads as a parameter, then its name (16.70).
 */
export function privateAddress(path: string, name: string): string {
    const segments: string[] = []
    for (const segment of path.replace(/\.abide$/, '').split('/'))
        if (segment !== '' && segment !== '..')
            segments.push(segment.replace(/[[\].]/g, ''))
    return `${PRIVATE_HANDLERS_ADDRESS}/${segments.join('/')}/${name}`
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
            `abide: ${source} answers at ${address}, and its handler's args do not declare \`${segment.name}\`. RULEBOOK 16.67.`,
        )
    }
}
