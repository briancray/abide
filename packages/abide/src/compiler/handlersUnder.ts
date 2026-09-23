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
import { RPC_ADDRESS } from '#server/CLIENT_BUILD.ts'
import { namesUnder } from '#server/namesUnder.ts'
import type { TypeSession } from './TypeSession.ts'

const HANDLER_DIRECTORY = 'server/rpc'

export async function handlersUnder(
    root: string,
    session: TypeSession,
): Promise<Mount[]> {
    const names = namesUnder(`${root}/${HANDLER_DIRECTORY}`, '**/*.ts').sort()
    const declared = await session.handlersIn(
        names.map((name) => `${root}/${HANDLER_DIRECTORY}/${name}`),
    )
    const mounts: Mount[] = []
    // 19.2 — one owner per address, and the error names both files.
    const owners = new Map<string, string>()
    for (let at = 0; at < names.length; at += 1) {
        const name = names[at] as string
        const source = `${HANDLER_DIRECTORY}/${name}`
        const path = name.replace(/\.ts$/, '')
        for (const { name: exported, method } of declared[at] ?? []) {
            if (method === undefined)
                throw new Error(
                    `abide: ${source} exports \`${exported}\`, which is not declared as a handler. A module under ${HANDLER_DIRECTORY} exports handlers alone, each declared by abide's \`GET(…)\` (or POST, PUT, PATCH, DELETE); anything else belongs beside it. RULEBOOK 19.16.`,
                )
            const address = `${RPC_ADDRESS}/${path}${exported === 'default' ? '' : `/${exported}`}`
            const owner = owners.get(address)
            if (owner !== undefined)
                throw new Error(
                    `abide: ${owner} and ${source} both declare a handler at ${address}. RULEBOOK 19.2.`,
                )
            owners.set(address, source)
            mounts.push({ address, method, source, name: exported })
        }
    }
    return mounts
}
