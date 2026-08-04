// callCliCommand(options) — run one subcommand against its target and write the result (MS3.2-3.4).
//
// The CLI is a THIRD client of the same HTTP face the browser proxy and MCP speak, and it is
// deliberately not a shortcut around it: even when the binary is hosting the app itself, the call goes
// over the loopback server it just booted, so middleware, identity, CSRF, schema validation, the memo
// and the run deadline all behave exactly as they do for a deployed request. A direct in-process
// handler call would be faster and would answer a different question.
//
// Output convention (MS3.4): JSON to stdout, pipeable; a streaming handler is line-streamed as it
// arrives (`jsonl` lines pass through verbatim, `sse` is unwrapped to its `data:` payloads, so both
// reach stdout as one JSON value per line); errors go to stderr as a JSON object, and the exit code
// names the failure class.

import { CSRF_HEADER } from '../../shared/internal/CSRF_HEADER.ts'
import {
    isStreamContentType,
    streamEncodingFor,
} from '../../shared/internal/decodeStreamResponse.ts'
import { readLines } from '../../shared/internal/readLines.ts'
import { rpcUrl } from '../../shared/internal/rpcUrl.ts'
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import type { CliCommand } from './cliCommands.ts'
import { cliExitCodeForStatus } from './cliExitCodeForStatus.ts'
import { reportStreamInterrupted, reportUnreachable } from './cliFailure.ts'

export interface CliCallOptions {
    origin: string
    token?: string | undefined
    command: CliCommand
    args: Record<string, unknown>
    // Pretty-print the JSON value. Decided by the caller from the TTY, the same way the log format is.
    pretty: boolean
    write(text: string): void
    writeError(text: string): void
}

function requestInit(options: CliCallOptions): RequestInit {
    const headers: Record<string, string> = { accept: 'application/json, application/jsonl' }
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
    if (options.command.read) return { method: options.command.method, headers }
    // A mutation carries its args in the body and must present the abide client's non-simple request
    // shape — `content-type: application/json` plus `x-abide`, which is what the CSRF gate reads.
    headers['content-type'] = 'application/json'
    headers[CSRF_HEADER] = '1'
    return {
        method: options.command.method,
        headers,
        body: JSON.stringify(options.args),
    }
}

// Reads carry args in the canonical `__abide_args` JSON blob — the machine form, the same one the
// browser proxy emits, which is why the address is built by the shared `rpcUrl` rather than restated
// here. (The flat per-field query form exists for hand-testing with curl; nothing generates it.)
function requestUrl(options: CliCallOptions): string {
    if (!options.command.read) return rpcUrl(options.origin, options.command.name)
    return rpcUrl(options.origin, options.command.name, { args: options.args })
}

// Report a non-2xx as a structured stderr object. The server's own error body is the payload when it
// sent one (typed errors keep their `name`/`data`, so a script can branch on the app's vocabulary);
// otherwise the status line is synthesised into the same shape, so stderr always parses.
async function reportFailure(response: Response, options: CliCallOptions): Promise<number> {
    let body: unknown
    try {
        body = await response.json()
    } catch {
        body = undefined
    }
    const payload =
        typeof body === 'object' && body !== null
            ? body
            : { status: response.status, statusText: response.statusText, message: body }
    options.writeError(`${JSON.stringify(payload, null, options.pretty ? 2 : 0)}\n`)
    return cliExitCodeForStatus(response.status)
}

// Line-stream a jsonl/sse body to stdout as it arrives (MS3.2). Both encodings are newline-framed, so
// one reader serves both — sse only adds the `data: ` prefix and blank-line framing to strip.
async function streamBody(response: Response, options: CliCallOptions): Promise<number> {
    const body = response.body
    if (body === null) return CLI_EXIT_CODES.ok
    const sse = streamEncodingFor(response.headers.get('content-type') ?? '') === 'sse'
    const emit = (line: string): void => {
        if (line === '') return
        if (!sse) {
            options.write(`${line}\n`)
            return
        }
        if (line.startsWith('data:')) options.write(`${line.slice(5).trim()}\n`)
    }
    for await (const line of readLines(body as unknown as AsyncIterable<Uint8Array>)) {
        emit(line.trimEnd())
    }
    return CLI_EXIT_CODES.ok
}

export async function callCliCommand(options: CliCallOptions): Promise<number> {
    let response: Response
    try {
        response = await fetch(requestUrl(options), requestInit(options))
    } catch (caught) {
        return reportUnreachable(options.origin, caught, options.writeError)
    }

    if (!response.ok) return await reportFailure(response, options)

    if (isStreamContentType(response.headers.get('content-type'))) {
        try {
            return await streamBody(response, options)
        } catch (caught) {
            return reportStreamInterrupted(caught, options.writeError)
        }
    }

    const text = await response.text()
    if (text === '') return CLI_EXIT_CODES.ok
    try {
        const value: unknown = JSON.parse(text)
        options.write(`${JSON.stringify(value, null, options.pretty ? 2 : 0)}\n`)
    } catch {
        // A handler that answered with something other than JSON (a hand-built Response) still reaches
        // stdout verbatim rather than being swallowed by the decoder.
        options.write(text.endsWith('\n') ? text : `${text}\n`)
    }
    return CLI_EXIT_CODES.ok
}
