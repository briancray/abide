// THE CLIENT FOR A RUNNING APP — what the shell (`shell.ts`), `call`, `logs`, `openapi` and `mcp` talk to
// it with, the shell on the app served here included.
// Which app is `--url`, then `ABIDE_APP_URL`, then the local one; `ABIDE_APP_TOKEN` is the bearer
// sent (36.6), and neither variable is read anywhere else.

import { LOGS_ADDRESS, RPC_ADDRESS } from '#shared/ADDRESSES.ts'
import { framedStream } from '#shared/framing.ts'
import type { Method } from '#shared/rpc.ts'
import { argsInURL, rpcRequest } from '#shared/rpcRequest.ts'
import type { Mount } from './answerRpc.ts'

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

// The exit codes the CLI answers a call with: 0 answered, 7 refused, 8 faulted.
const REFUSED = 7
const FAULTED = 8

/**
 * Calls one handler on a running app; returns the CLI's exit code and the answer's text.
 *
 * 38.8 — ONE CALL TO ONE HANDLER, spelled `invoices/getInvoice id=4310` in argv and in the shell
 * alike, and 38.62's args.
 */
export async function callHandler(
    url: string,
    path: string,
    given: string[],
    method: string | undefined,
    handlers: Mount[],
    signal?: AbortSignal,
): Promise<{ code: number; text: string }> {
    const address = `${RPC_ADDRESS}/${path.replace(/^\//, '')}`
    // A socket's row is under `SOCKET_ADDRESS`, so an rpc address never finds one.
    const handler = handlers.find((mount) => mount.address === address)
    const args = callArgs(given)
    const chosen = (method?.toUpperCase() ??
        (handler?.method as Method | undefined) ??
        (args === undefined ? 'GET' : 'POST')) as Method
    const request =
        args instanceof URLSearchParams
            ? textRequest(chosen, address, args)
            : rpcRequest(chosen, address, args)
    const answer = await fetch(`${url}${request.url}`, {
        ...request.init,
        headers: { ...remoteHeaders(), ...request.init.headers },
        signal: signal ?? null,
    })
    const text = await answer.text()
    const code =
        answer.status >= 500 ? FAULTED : answer.status >= 400 ? REFUSED : 0
    return { code, text }
}

/**
 * A call's args out of the words after its address, or `undefined` where there are none.
 *
 * 38.62 — `name=value` words, kept as the text they are for the app to coerce as it coerces a query's
 * (19.8), against the schema it holds the call to; or, where the first word opens one, a JSON object.
 */
function callArgs(
    given: string[],
): Record<string, unknown> | URLSearchParams | undefined {
    // An empty word is no arg, as `call x ''` from a script means none.
    const words: string[] = []
    for (const word of given) if (word.trim() !== '') words.push(word)
    if (words.length === 0) return undefined
    if ((words[0] as string).trimStart().startsWith('{'))
        return JSON.parse(words.join(' ')) as Record<string, unknown>
    const pairs = new URLSearchParams()
    for (const word of words) {
        const at = word.indexOf('=')
        if (at < 1)
            throw new Error(
                `call: args are name=value, or one JSON object — not '${word}'`,
            )
        pairs.append(word.slice(0, at), word.slice(at + 1))
    }
    return pairs
}

/** The request a call with text args is: in the URL where its method carries them, a form where not. */
function textRequest(
    method: Method,
    address: string,
    pairs: URLSearchParams,
): { url: string; init: RequestInit } {
    if (argsInURL(method))
        return { url: `${address}?${pairs}`, init: { method } }
    return {
        url: address,
        init: {
            method,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: pairs.toString(),
        },
    }
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
    for await (const record of framedStream(answer.body, 'data: ')) {
        const { time, level, namespace, message } = record as Record<
            string,
            string
        >
        console.log(`${time} ${level} ${namespace} ${message}`)
    }
    return 0
}
