// THE CLIENT FOR A RUNNING APP — what the shell (`shell.ts`), `call`, `logs`, `openapi` and `mcp` talk to
// it with, the shell on the app served here included.
// Which app is `--url`, then `ABIDE_APP_URL`, then the local one; `ABIDE_APP_TOKEN` is the bearer
// sent (36.6), and neither variable is read anywhere else.

import { LOGS_ADDRESS, RPC_ADDRESS } from '#shared/ADDRESSES.ts'
import { applyPatch } from '#shared/applyPatch.ts'
import type { LogRecord } from '#shared/log.ts'
import type { PatchOp } from '#shared/reactive/PATCH_SINKS.ts'
import type { Method } from '#shared/rpc.ts'
import { argsInURL, rpcRequest } from '#shared/rpcRequest.ts'
import type { Mount } from './answerRpc.ts'
import { DEFAULT_PORT } from './DEFAULT_PORT.ts'
import { withoutTrailingSlash } from './withoutTrailingSlash.ts'

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
    return withoutTrailingSlash(
        remoteUrl(given) ??
            `http://localhost:${process.env.PORT ?? DEFAULT_PORT}`,
    )
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
 * (19.7), against the schema it holds the call to; or, where the first word opens one, a JSON object.
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
        headers: { ...remoteHeaders(), accept: 'text/event-stream' },
    })
    if (!answer.ok || answer.body === null) {
        console.error(
            `logs: the app answered ${answer.status}. ABIDE_LOGS opens the subscription.`,
        )
        return 1
    }
    // 18.20 — the lines held arrive as the value, and each line after as an `add` at `/-`; a trim's
    // `remove`s are the buffer letting old lines go, which a tail has already printed.
    for await (const event of eventsOf(answer.body)) {
        if (event.name === 'error') console.error(`logs: ${event.data}`)
        const lines =
            event.name === 'value'
                ? ((JSON.parse(event.data) as LogRecord[] | null) ?? [])
                : event.name === 'patch'
                  ? addedBy(JSON.parse(event.data) as PatchOp[])
                  : []
        for (const { time, level, namespace, message } of lines)
            console.log(`${time} ${level} ${namespace} ${message}`)
    }
    return 0
}

/** The records a patch appended: the value of each `add`. */
function addedBy(ops: PatchOp[]): LogRecord[] {
    const added: LogRecord[] = []
    for (const op of ops) if (op.op === 'add') added.push(op.value as LogRecord)
    return added
}

/**
 * Follows a `GET` of the app at `url` as an event stream, printing its value and its value after each
 * patch; returns the exit code.
 *
 * 38.70, 18.20 — THE EVENT STREAM ANY CLIENT MAY ASK A FOLLOWED `GET` FOR, read by one: `event: value`
 * replaces what is held and `event: patch` is JSON Patch applied over it. A handler the server does
 * not follow — one built per request — answers once, and is printed once.
 */
export async function watch(
    url: string,
    address: string,
    given: string[],
    signal?: AbortSignal,
): Promise<number> {
    const path = `${RPC_ADDRESS}/${address.replace(/^\//, '')}`
    const args = callArgs(given)
    const request =
        args instanceof URLSearchParams
            ? textRequest('GET', path, args)
            : rpcRequest('GET', path, args)
    const answer = await fetch(`${url}${request.url}`, {
        ...request.init,
        headers: {
            ...remoteHeaders(),
            ...(request.init.headers as Record<string, string> | undefined),
            accept: 'text/event-stream',
        },
        signal: signal ?? null,
    })
    if (!answer.ok) {
        console.error(`watch: ${await answer.text()}`)
        return 1
    }
    const type = answer.headers.get('content-type') ?? ''
    if (!type.startsWith('text/event-stream') || answer.body === null) {
        console.log(await answer.text())
        return 0
    }
    let held: unknown
    for await (const event of eventsOf(answer.body)) {
        if (event.name === 'value') held = JSON.parse(event.data)
        else if (event.name === 'patch')
            applyPatch(held, JSON.parse(event.data) as PatchOp[])
        else {
            // A refresh the handler refused: what is held stays, and the refusal is said.
            if (event.name === 'error') console.error(`watch: ${event.data}`)
            continue
        }
        console.log(JSON.stringify(held))
    }
    return 0
}

/** Each event of an event stream: its `event` name, `message` where it named none, and its `data`. */
async function* eventsOf(
    body: ReadableStream<Uint8Array>,
): AsyncIterable<{ name: string; data: string }> {
    const decoder = new TextDecoder()
    let buffered = ''
    for await (const chunk of body) {
        buffered += decoder.decode(chunk, { stream: true })
        for (
            let end = buffered.indexOf('\n\n');
            end !== -1;
            end = buffered.indexOf('\n\n')
        ) {
            const block = buffered.slice(0, end)
            buffered = buffered.slice(end + 2)
            let name = 'message'
            let data: string | undefined
            for (const line of block.split('\n')) {
                if (line.startsWith('event:')) name = line.slice(6).trim()
                else if (line.startsWith('data:')) {
                    const field = line.slice(5).replace(/^ /, '')
                    data = data === undefined ? field : `${data}\n${field}`
                }
            }
            // A comment alone — the stream's opener — is no event.
            if (data !== undefined) yield { name, data }
        }
    }
}
