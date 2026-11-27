// 16.2 AND 16.70 — EVERY `rpc` AN APP DECLARES, AND WHERE IT IS ANSWERED. A server file answers at its
// own path, wherever it stands (16.73): its default or the `rpc` named for it there, each other named
// `rpc` below it by its name, or wherever its `address` says — the app's public surface. A server file exporting none is a module. A value a
// `<script server>` exports is its file's alone, answered below `/__abide/handlers/` at the file's
// path and its name, and listed nowhere (16.71). One row per verb each answers (16.111).
//
// READ, NOT RUN. The build finds handlers by what their files SAY rather than by importing them,
// so a build never runs server code: a server file may open a database at import, and nothing
// about building a browser bundle is a reason to. The checker the build already holds lists what
// each module exports and which call declares each (16.73).

import { handlerFileMount } from '#server/handlerFileMount.ts'
import type { Mount } from '#server/mountHandlers.ts'
import { PRIVATE_EXPORT } from '#server/PRIVATE_EXPORT.ts'
import { PRIVATE_HANDLERS_ADDRESS } from '#shared/ADDRESSES.ts'
import { parseRoutePattern } from '#shared/routePattern.ts'
import { surfaceName } from '#shared/surfaceName.ts'

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
    for (const { path, relative, route, scope, matchers } of files) {
        const exported = declared.get(path)
        if (exported === undefined) continue
        // 16.2 — the default and the export named for the file both answer at the file's route.
        const stem = relative.slice(relative.lastIndexOf('/') + 1).split('.')[0]
        try {
            let atRoute: string | undefined
            for (const each of exported) {
                if (each.method === undefined) continue
                // 16.73, 16.113 — the default or the one named for the file at the file's route, any
                // other named one below it by its name, or wherever its `address` says.
                const address =
                    each.address ??
                    (each.name === 'default' || each.name === stem
                        ? route
                        : `${route}/${each.name}`)
                if (
                    each.address === undefined &&
                    address === route &&
                    atRoute !== undefined &&
                    atRoute !== each.name
                )
                    throw new Error(
                        `abide: ${relative} exports an rpc as its default and another named ${stem}, and both would answer at ${route}: keep one. RULEBOOK 16.2.`,
                    )
                if (each.address === undefined && address === route)
                    atRoute = each.name
                refuseUndeclaredParameters(address, each.args, relative)
                for (const method of each.methods) {
                    // 20.13 — one name per handler on every generated surface.
                    const surface = surfaceName(method, address)
                    const named = names.get(surface)
                    if (named !== undefined)
                        throw new Error(
                            `abide: ${named} and ${relative} are both named ${surface} on the generated surfaces. RULEBOOK 20.13.`,
                        )
                    names.set(surface, relative)
                    mounts.push(
                        handlerFileMount(
                            { address, source: relative, scope, matchers },
                            {
                                ...each,
                                method,
                                copy:
                                    method === each.method
                                        ? each.copy
                                        : undefined,
                                result:
                                    method === each.method
                                        ? each.result
                                        : undefined,
                                // 16.117 — a write's face takes what its member is given, which
                                // the read's args say nothing of.
                                args:
                                    method === each.method
                                        ? each.args
                                        : undefined,
                                defaults:
                                    method === each.method
                                        ? each.defaults
                                        : undefined,
                            },
                            each.name,
                        ),
                    )
                }
                diagnostics.warn(each.unread)
            }
        } catch (thrown) {
            diagnostics.at(relative, thrown)
        }
    }
    for (const { path, relative, position, place, scope } of serving) {
        // 34.24 — a dependency's file answers where a mount places it, and its handlers below the
        // path it has there.
        const below = place === 'dependency' ? relative : position
        const exported = declared.get(host.projectionOf(path)) ?? []
        for (const each of exported) {
            if (each.method === undefined) continue
            if (!each.name.startsWith(PRIVATE_EXPORT)) continue
            const name = each.name.slice(PRIVATE_EXPORT.length)
            const address = privateAddress(below, name)
            for (const method of each.methods)
                mounts.push({
                    address,
                    method,
                    methods: each.methods,
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
                    middleware: each.middleware,
                    copy: method === each.method ? each.copy : undefined,
                    defaults:
                        method === each.method ? each.defaults : undefined,
                    args: method === each.method ? each.args : undefined,
                    result: method === each.method ? each.result : undefined,
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
              properties?: Record<string, unknown> | undefined
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
