// THE CLIENT FOR A RUNNING APP — what `call`, `connect`, `logs`, `openapi` and `mcp` talk to it with.
// Which app is `--url`, then `ABIDE_APP_URL`, then the local one; `ABIDE_APP_TOKEN` is the bearer
// sent (36.6), and neither variable is read anywhere else.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import type { Method } from '#shared/rpc.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import type { Mount } from './answerRpc.ts'
import { RPC_ADDRESS } from './CLIENT_BUILD.ts'
import { appRoot, buildDirectory } from './createApp.ts'

// The running app asked for, or `undefined` where none is — which is where `openapi` and `mcp`
// boot the local one instead.
export function remoteUrl(given: string | undefined): string | undefined {
    return given ?? process.env.ABIDE_APP_URL
}

export function appUrl(given: string | undefined): string {
    const url =
        remoteUrl(given) ?? `http://localhost:${process.env.PORT ?? 3000}`
    return url.replace(/\/$/, '')
}

export function remoteHeaders(): Record<string, string> {
    const token = process.env.ABIDE_APP_TOKEN
    return token === undefined ? {} : { authorization: `Bearer ${token}` }
}

// The method a handler is declared with, read off the local build where there is one — so a call
// is spelled the same whatever the handler's method, and the flag is only for an app built elsewhere.
async function methodOf(address: string): Promise<Method | undefined> {
    const root = appRoot(undefined)
    if (root === undefined) return undefined
    const table = `${buildDirectory(root)}/rpc.ts`
    if (!existsSync(table)) return undefined
    const { handlers } = (await import(Bun.pathToFileURL(table).href)) as {
        handlers: Mount[]
    }
    // A socket's row is under `SOCKET_ADDRESS`, so an rpc address never finds one.
    return handlers.find((mount) => mount.address === address)?.method as
        | Method
        | undefined
}

// The exit codes the CLI answers a call with: 0 answered, 7 refused, 8 faulted.
const REFUSED = 7
const FAULTED = 8

// 38.8 — ONE CALL TO ONE HANDLER, spelled `invoices/getInvoice '{"id":"4310"}'` in argv and in the
// shell alike.
export async function callHandler(
    url: string,
    path: string,
    argsText: string | undefined,
    method: string | undefined,
): Promise<{ code: number; text: string }> {
    const address = `${RPC_ADDRESS}/${path.replace(/^\//, '')}`
    const args =
        argsText === undefined || argsText.trim() === ''
            ? undefined
            : (JSON.parse(argsText) as Record<string, unknown>)
    const chosen = (method?.toUpperCase() ??
        (await methodOf(address)) ??
        (args === undefined ? 'GET' : 'POST')) as Method
    const request = rpcRequest(chosen, address, args)
    const answer = await fetch(`${url}${request.url}`, {
        ...request.init,
        headers: { ...remoteHeaders(), ...request.init.headers },
    })
    const text = await answer.text()
    const code =
        answer.status >= 500 ? FAULTED : answer.status >= 400 ? REFUSED : 0
    return { code, text }
}
