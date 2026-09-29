// 16.2 AND 19.1 — EVERY HANDLER AN APP DECLARES, AND WHERE IT IS ANSWERED. A handler is an export of
// a module under `server/rpc`, and its address is the module's path below that directory and then
// the export's name — `default` answering at the path alone.
//
// READ, NOT RUN. The build finds handlers by what their modules SAY rather than by importing them,
// so a build never runs server code: an app's module may open a database at import, and nothing
// about building a browser bundle is a reason to. The checker the build already holds lists what a
// module exports and which call declares each (19.16) — which is also what makes an export that is
// not a handler a refusal here rather than an address that silently never answers.

import type { Mount } from '#server/answerRpc.ts'
import { namesUnder } from '#server/namesUnder.ts'
import { RPC_ADDRESS, SOCKET_ADDRESS } from '#shared/ADDRESSES.ts'
import type { Diagnosis, TypeSession } from './TypeSession.ts'

const HANDLER_DIRECTORY = 'server/rpc'
// 18.1 AND 19.1 — EVERY SOCKET, MOUNTED AS A HANDLER IS: the module's path below `server/sockets`,
// then the export. Only `socket(…)` is exported from there.
const SOCKET_DIRECTORY = 'server/sockets'

// One module under either tree: where it is from the root, its address path below its tree, and
// which tree that was.
type HandlerModule = { source: string; path: string; isSocket: boolean }

// Every module under both trees, handlers first.
function modulesUnder(root: string): HandlerModule[] {
    const modules: HandlerModule[] = []
    for (const directory of [HANDLER_DIRECTORY, SOCKET_DIRECTORY])
        for (const name of namesUnder(`${root}/${directory}`, '**/*.ts').sort())
            modules.push({
                source: `${directory}/${name}`,
                path: name.replace(/\.ts$/, ''),
                isSocket: directory === SOCKET_DIRECTORY,
            })
    return modules
}

// Whether there is anything under either tree, asked before a checker is opened to read it: an
// app of handlers alone has no `.abide` to say it is an app.
export function declaresHandlers(root: string): boolean {
    return modulesUnder(root).length > 0
}

// Both trees, off one read of the checker, into one table — a socket is a row whose method is
// `SOCKET`. 19.2 — one owner per address, and the error names both files. 18.30 — with what the
// build could not read of a copy's options.
export async function handlersUnder(
    root: string,
    session: TypeSession,
): Promise<{ mounts: Mount[]; warnings: Diagnosis[] }> {
    const modules = modulesUnder(root)
    const paths: string[] = []
    for (const { source } of modules) paths.push(`${root}/${source}`)
    const declared = await session.handlersIn(paths)
    const mounts: Mount[] = []
    const warnings: Diagnosis[] = []
    const owners = new Map<string, string>()
    for (let at = 0; at < modules.length; at += 1) {
        const { source, path, isSocket } = modules[at] as HandlerModule
        for (const {
            name: exported,
            method,
            ui,
            copy,
            args,
            unread,
        } of declared[at] ?? []) {
            if (method === undefined || (method === 'SOCKET') !== isSocket)
                throw new Error(
                    isSocket
                        ? `abide: ${source} exports \`${exported}\`, which is not declared by abide's \`socket(…)\`. A module under ${SOCKET_DIRECTORY} exports sockets alone. RULEBOOK 19.1.`
                        : `abide: ${source} exports \`${exported}\`, which is not declared as a handler. A module under ${HANDLER_DIRECTORY} exports handlers alone, each declared by abide's \`GET(…)\` (or POST, PUT, PATCH, DELETE); anything else belongs beside it. RULEBOOK 19.16.`,
                )
            const address = `${isSocket ? SOCKET_ADDRESS : RPC_ADDRESS}/${path}${exported === 'default' ? '' : `/${exported}`}`
            const owner = owners.get(address)
            if (owner !== undefined)
                throw new Error(
                    `abide: ${owner} and ${source} both declare a ${isSocket ? 'socket' : 'handler'} at ${address}. RULEBOOK 19.2.`,
                )
            owners.set(address, source)
            mounts.push({
                address,
                method,
                source,
                name: exported,
                ui,
                copy,
                args,
            })
            warnings.push(...unread)
        }
    }
    return { mounts, warnings }
}
