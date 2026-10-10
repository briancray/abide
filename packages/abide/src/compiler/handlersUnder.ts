// 16.2 AND 19.1 — EVERY HANDLER AN APP DECLARES, AND WHERE IT IS ANSWERED. A handler is an export of
// a module under `server/rpc`, and its address is the module's path below that directory and then
// the export's name — `default` answering at the path alone.
//
// READ, NOT RUN. The build finds handlers by what their modules SAY rather than by importing them,
// so a build never runs server code: an app's module may open a database at import, and nothing
// about building a browser bundle is a reason to. The checker the build already holds lists what a
// module exports and which call declares each (19.15) — which is also what makes an export that is
// not a handler a refusal here rather than an address that silently never answers.

import type { Mount } from '#server/answerRpc.ts'
import { namesUnder } from '#server/namesUnder.ts'
import { RPC_ADDRESS } from '#shared/ADDRESSES.ts'
import { declaredExports } from './declaredExports.ts'
import type { Diagnosis, TypeSession } from './TypeSession.ts'

const HANDLER_DIRECTORY = 'server/rpc'

// One module under the tree: where it is from the root, and its address path below the tree.
type HandlerModule = { source: string; path: string }

/** Every module under `server/rpc`. */
function modulesUnder(root: string): HandlerModule[] {
    const modules: HandlerModule[] = []
    for (const name of namesUnder(
        `${root}/${HANDLER_DIRECTORY}`,
        '**/*.ts',
    ).sort())
        modules.push({
            source: `${HANDLER_DIRECTORY}/${name}`,
            path: name.replace(/\.ts$/, ''),
        })
    return modules
}

/**
 * Whether the app has any module under `server/rpc`.
 *
 * Asked before a checker is opened to read it: an app of handlers alone has no `.abide` to say it
 * is an app.
 */
export function declaresHandlers(root: string): boolean {
    return modulesUnder(root).length > 0
}

/**
 * The app's handler mounts, with the warnings the build raised reading them.
 *
 * Off one read of the checker. 19.1 — one owner per address, and the error names both files. 18.15 —
 * with what the build could not read of a copy's options.
 */
export async function handlersUnder(
    root: string,
    session: TypeSession,
): Promise<{ mounts: Mount[]; warnings: Diagnosis[] }> {
    const modules = modulesUnder(root)
    const paths: string[] = []
    for (const { source } of modules) paths.push(`${root}/${source}`)
    const project = await session.project()
    const declared =
        project === undefined
            ? []
            : await declaredExports(project, session.tsconfig, paths)
    const mounts: Mount[] = []
    const warnings: Diagnosis[] = []
    const owners = new Map<string, string>()
    for (let at = 0; at < modules.length; at += 1) {
        const { source, path } = modules[at] as HandlerModule
        for (const {
            name: exported,
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
            if (method === undefined)
                throw new Error(
                    `abide: ${source} exports \`${exported}\`, which is not declared as a handler. A module under ${HANDLER_DIRECTORY} exports handlers alone, each declared by abide's \`GET(…)\` (or POST, PUT, PATCH, DELETE); anything else belongs beside it. RULEBOOK 19.15.`,
                )
            const address = `${RPC_ADDRESS}/${path}${exported === 'default' ? '' : `/${exported}`}`
            const owner = owners.get(address)
            if (owner !== undefined)
                throw new Error(
                    `abide: ${owner} and ${source} both declare a handler at ${address}. RULEBOOK 19.1.`,
                )
            owners.set(address, source)
            mounts.push({
                address,
                method,
                source,
                name: exported,
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
