// THE CLIENT FOR A RUNNING APP — what `call`, `connect`, `logs`, `openapi` and `mcp` talk to it with,
// and the shell `start` opens on the app it serves.
// Which app is `--url`, then `ABIDE_APP_URL`, then the local one; `ABIDE_APP_TOKEN` is the bearer
// sent (36.6), and neither variable is read anywhere else.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { LOGS_ADDRESS, RPC_ADDRESS } from '#shared/ADDRESSES.ts'
import type { Method } from '#shared/rpc.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import type { Mount } from './answerRpc.ts'
import { appRoot, buildDirectory } from './createApp.ts'

/**
 * The running app asked for, or `undefined` where none is.
 *
 * `undefined` is where `openapi` and `mcp` boot the local one instead.
 */
export function remoteUrl(given: string | undefined): string | undefined {
    return given ?? process.env.ABIDE_APP_URL
}

/** The URL of the running app asked for, or the local one, with no trailing slash. */
export function appUrl(given: string | undefined): string {
    const url =
        remoteUrl(given) ?? `http://localhost:${process.env.PORT ?? 3000}`
    return url.replace(/\/$/, '')
}

/** The headers a call to a running app carries: `ABIDE_APP_TOKEN` as the bearer, where set. */
export function remoteHeaders(): Record<string, string> {
    const token = process.env.ABIDE_APP_TOKEN
    return token === undefined ? {} : { authorization: `Bearer ${token}` }
}

/**
 * The method a handler at `address` is declared with, where the caller can say.
 *
 * So a call is spelled the same whatever the handler's method, and the flag is only for an app
 * nobody here knows the table of.
 */
export type MethodOf = (address: string) => Promise<Method | undefined>

/** The method a handler is declared with, off the local build where there is one. */
export async function methodOnDisk(
    address: string,
): Promise<Method | undefined> {
    const root = appRoot(undefined)
    if (root === undefined) return undefined
    const table = `${buildDirectory(root)}/rpc.ts`
    if (!existsSync(table)) return undefined
    const { handlers } = (await import(Bun.pathToFileURL(table).href)) as {
        handlers: Mount[]
    }
    return methodIn(handlers, address)
}

/** The method `address` is declared with among `handlers`. */
export function methodIn(
    handlers: Mount[],
    address: string,
): Method | undefined {
    // A socket's row is under `SOCKET_ADDRESS`, so an rpc address never finds one.
    return handlers.find((mount) => mount.address === address)?.method as
        | Method
        | undefined
}

// The exit codes the CLI answers a call with: 0 answered, 7 refused, 8 faulted.
const REFUSED = 7
const FAULTED = 8

/**
 * Calls one handler on a running app; returns the CLI's exit code and the answer's text.
 *
 * 38.8 — ONE CALL TO ONE HANDLER, spelled `invoices/getInvoice '{"id":"4310"}'` in argv and in the
 * shell alike.
 */
export async function callHandler(
    url: string,
    path: string,
    argsText: string | undefined,
    method: string | undefined,
    methodOf: MethodOf,
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

/**
 * Runs the interactive shell against a running app until `exit` or the end of input.
 *
 * 38.7 — THE SHELL AGAINST A RUNNING APP: a line is a command, and `call` is the same spelling it
 * is in argv (38.8). Answers `exit` where the line said so and `ended` where the input did, so a
 * host that owns the app can stop it on the one and keep serving on the other.
 */
export async function shell(
    url: string,
    methodOf: MethodOf,
): Promise<'exit' | 'ended'> {
    // A PROMPT IS FOR A TERMINAL. Input piped in is answered without one, and a process whose output
    // nobody reads — a container's, a test's — is not written to until there is an answer to write.
    const prompted = process.stdin.isTTY === true
    const prompt = (): void => {
        if (prompted) process.stdout.write('> ')
    }
    if (prompted) console.log('  call <address> [args]   logs   exit')
    prompt()
    for await (const line of console) {
        const [word, address, ...rest] = line.trim().split(/\s+/)
        if (word === 'exit' || word === 'quit') return 'exit'
        if (word === 'call' && address !== undefined) {
            const answered = await callHandler(
                url,
                address,
                rest.join(' ') || undefined,
                undefined,
                methodOf,
            )
            console.log(
                answered.text === ''
                    ? `(${answered.code === 0 ? 'no content' : `exit ${answered.code}`})`
                    : answered.text,
            )
        } else if (word === 'logs') await followLogs(url)
        else if (word !== undefined && word !== '')
            console.log(`unknown: ${word}`)
        prompt()
    }
    return 'ended'
}

/**
 * Prints every line `log.records` publishes, as it is written; returns the exit code.
 *
 * 38.10.
 */
export async function followLogs(url: string): Promise<number> {
    const answer = await fetch(`${url}${LOGS_ADDRESS}`, {
        headers: remoteHeaders(),
    })
    if (!answer.ok || answer.body === null) {
        console.error(
            `logs: the app answered ${answer.status}. ABIDE_LOGS opens the subscription.`,
        )
        return 1
    }
    let buffered = ''
    const decoder = new TextDecoder()
    for await (const chunk of answer.body) {
        buffered += decoder.decode(chunk, { stream: true })
        let at = buffered.indexOf('\n\n')
        while (at !== -1) {
            const event = buffered.slice(0, at)
            buffered = buffered.slice(at + 2)
            if (event.startsWith('data: ')) {
                const record = JSON.parse(event.slice(6)) as Record<
                    string,
                    string
                >
                console.log(
                    `${record.time} ${record.level} ${record.namespace} ${record.message}`,
                )
            }
            at = buffered.indexOf('\n\n')
        }
    }
    return 0
}
