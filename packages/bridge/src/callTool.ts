// ONE MCP TOOL OF THIS MACHINE, CALLED WITH NO MODEL (44.95): the bridge speaks MCP to the visitor's
// server itself — the server as 44.58 finds it, started as Claude Code would start it — and hands back
// what the tool answered. A server is started for the one call and ended with it.

import type { ToolAnswer } from '@abide/abide/server'

import { messageOf } from './messageOf.ts'
import { readLines } from './readLines.ts'
import { scratchDirectory } from './scratchDirectory.ts'

const PROTOCOL_VERSION = '2025-06-18'
/** How long a `headersHelper` has to write its headers, as Claude Code gives one. */
const HEADERS_HELPER_MILLISECONDS = 10_000

/** A server as an MCP config's `mcpServers` holds it: a command run over stdio, or an http address. */
type ServerConfiguration = {
    type?: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    /** A shell command writing a JSON object of headers, run for every call, over `headers`. */
    headersHelper?: string
}

type RpcMessage = {
    id?: number | string
    method?: string
    result?: unknown
    error?: { message?: string }
}

/** One server spoken to: a request it answers, a notification it is sent, and the end of it. */
type Session = {
    send(message: {
        id?: number
        method: string
        params?: unknown
    }): Promise<RpcMessage | undefined>
    close(): Promise<void>
}

/**
 * What `tool` of `server` answered `input`, its server named `name` in what it says.
 *
 * Throws where the server cannot be started or reached, or fails the protocol before the call.
 */
export async function callTool(
    name: string,
    server: unknown,
    tool: string,
    input: unknown,
    signal: AbortSignal,
): Promise<ToolAnswer> {
    const configuration = server as ServerConfiguration
    const type =
        configuration.type ??
        (configuration.command === undefined ? undefined : 'stdio')
    let session: Session
    if (type === 'stdio' && configuration.command !== undefined)
        session = await stdioSession(name, configuration, signal)
    else if (type === 'http' && configuration.url !== undefined)
        session = httpSession(
            name,
            configuration.url,
            {
                ...configuration.headers,
                ...(await helpedHeaders(name, configuration, signal)),
            },
            signal,
        )
    else
        throw new Error(
            `The ${name} MCP server is reached over ${type ?? 'nothing this bridge knows'}, and a call reaches a server over stdio or http.`,
        )
    try {
        const opened = await session.send({
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: 'abide-bridge', version: '1' },
            },
        })
        if (opened?.error !== undefined)
            throw new Error(
                `The ${name} MCP server refused to start a session: ${opened.error.message}`,
            )
        await session.send({ method: 'notifications/initialized' })
        const called = await session.send({
            id: 2,
            method: 'tools/call',
            params: { name: tool, arguments: input ?? {} },
        })
        // A call the server refused is the tool's answer, failed, as Claude Code would show it.
        if (called?.error !== undefined)
            return {
                content: [
                    { type: 'text', text: called.error.message ?? 'failed' },
                ],
                isError: true,
            }
        return answerOf(called?.result)
    } finally {
        await session.close()
    }
}

/** An MCP tool result as a `ToolAnswer`: text and images as they are, anything else as its text or JSON. */
function answerOf(result: unknown): ToolAnswer {
    const { content, structuredContent, isError } = (result ?? {}) as {
        content?: {
            type: string
            text?: string
            data?: string
            mimeType?: string
            resource?: { text?: string }
        }[]
        structuredContent?: unknown
        isError?: boolean
    }
    const pieces: ToolAnswer['content'] = []
    for (const piece of content ?? [])
        if (piece.type === 'text')
            pieces.push({ type: 'text', text: piece.text ?? '' })
        else if (
            piece.type === 'image' &&
            piece.data !== undefined &&
            piece.mimeType !== undefined
        )
            pieces.push({
                type: 'image',
                data: piece.data,
                mimeType: piece.mimeType,
            })
        else
            pieces.push({
                type: 'text',
                text: piece.resource?.text ?? JSON.stringify(piece),
            })
    if (pieces.length === 0 && structuredContent !== undefined)
        pieces.push({ type: 'text', text: JSON.stringify(structuredContent) })
    return { content: pieces, isError: isError === true }
}

/**
 * A server run as its `command`, in an empty directory removed when it ends, with this process's
 * variables and its own `env` — as Claude Code runs one (44.15) — spoken to a line of JSON at a time.
 */
async function stdioSession(
    name: string,
    configuration: ServerConfiguration,
    signal: AbortSignal,
): Promise<Session> {
    const { directory, remove } = await scratchDirectory()
    let child: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
    try {
        child = Bun.spawn({
            cmd: [
                configuration.command as string,
                ...(configuration.args ?? []),
            ],
            cwd: directory,
            env: { ...Bun.env, ...configuration.env },
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            signal,
        })
    } catch (thrown) {
        await remove()
        throw new Error(
            `The ${name} MCP server could not be started: ${messageOf(thrown)}`,
        )
    }
    const stderr = new Response(child.stderr).text()
    const waiting = new Map<number | string, (message: RpcMessage) => void>()
    const ended = (async () => {
        for await (const line of readLines(child.stdout)) {
            let message: RpcMessage
            try {
                message = JSON.parse(line) as RpcMessage
            } catch {
                // A line that is not JSON is the server's own chatter.
                continue
            }
            if (message.method === undefined) {
                if (message.id !== undefined) waiting.get(message.id)?.(message)
                continue
            }
            // A request of the server's — a root, a sample, a question — is one no model is here to answer.
            if (message.id !== undefined)
                child.stdin.write(
                    `${JSON.stringify(
                        message.method === 'ping'
                            ? { jsonrpc: '2.0', id: message.id, result: {} }
                            : {
                                  jsonrpc: '2.0',
                                  id: message.id,
                                  error: {
                                      code: -32601,
                                      message:
                                          'abide-bridge answers no request of a server.',
                                  },
                              },
                    )}\n`,
                )
        }
    })()
    return {
        async send(message) {
            const answered =
                message.id === undefined
                    ? undefined
                    : new Promise<RpcMessage | undefined>((resolve) => {
                          waiting.set(message.id as number, resolve)
                          void ended.then(() => resolve(undefined))
                      })
            child.stdin.write(
                `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`,
            )
            await child.stdin.flush()
            if (answered === undefined) return undefined
            const reply = await answered
            if (reply === undefined)
                throw new Error(
                    signal.aborted
                        ? 'The call was ended.'
                        : `The ${name} MCP server exited ${await child.exited} before it answered ${message.method}.\n${(await stderr).slice(-2000)}`,
                )
            return reply
        },
        async close() {
            child.kill()
            await child.exited
            await remove()
        },
    }
}

/**
 * 44.95 — the headers a server's `headersHelper` writes, run as Claude Code runs it: in a shell, told
 * the server's name and address, given ten seconds, its stdout a JSON object of text.
 */
async function helpedHeaders(
    name: string,
    configuration: ServerConfiguration,
    signal: AbortSignal,
): Promise<Record<string, string>> {
    if (configuration.headersHelper === undefined) return {}
    const child = Bun.spawn(['sh', '-c', configuration.headersHelper], {
        env: {
            ...process.env,
            CLAUDE_CODE_MCP_SERVER_NAME: name,
            CLAUDE_CODE_MCP_SERVER_URL: configuration.url as string,
        },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: HEADERS_HELPER_MILLISECONDS,
        signal,
    })
    const [written, said, exited] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    if (exited !== 0)
        throw new Error(
            `The ${name} MCP server's headersHelper exited ${exited}: ${said.slice(-2000)}`,
        )
    let headers: unknown
    try {
        headers = JSON.parse(written)
    } catch {
        headers = undefined
    }
    if (
        headers === null ||
        typeof headers !== 'object' ||
        Array.isArray(headers) ||
        Object.values(headers).some((value) => typeof value !== 'string')
    )
        throw new Error(
            `The ${name} MCP server's headersHelper wrote no JSON object of text headers.`,
        )
    return headers as Record<string, string>
}

/** A server at an http address, each message posted, its answer read as JSON or from an event stream. */
function httpSession(
    name: string,
    url: string,
    sent: Record<string, string>,
    signal: AbortSignal,
): Session {
    let sessionId: string | null = null
    return {
        async send(message) {
            const headers: Record<string, string> = {
                ...sent,
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                'mcp-protocol-version': PROTOCOL_VERSION,
            }
            if (sessionId !== null) headers['mcp-session-id'] = sessionId
            const answer = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({ jsonrpc: '2.0', ...message }),
                signal,
            })
            sessionId = answer.headers.get('mcp-session-id') ?? sessionId
            if (answer.status === 401 || answer.status === 403)
                throw new Error(
                    `The ${name} MCP server asks for a sign-in (${answer.status}): a call carries only the headers its configuration names and its headersHelper writes, and none Claude Code signed in with.`,
                )
            if (!answer.ok)
                throw new Error(
                    `The ${name} MCP server answered ${message.method} ${answer.status}: ${(await answer.text()).slice(0, 2000)}`,
                )
            if (message.id === undefined || answer.body === null) {
                await answer.body?.cancel()
                return undefined
            }
            if (
                !(answer.headers.get('content-type') ?? '').includes(
                    'text/event-stream',
                )
            )
                return (await answer.json()) as RpcMessage
            let data = ''
            for await (const line of readLines(answer.body)) {
                if (line.startsWith('data:')) {
                    data += `${data === '' ? '' : '\n'}${line.slice(5).trimStart()}`
                    continue
                }
                if (line !== '' || data === '') continue
                const event = JSON.parse(data) as RpcMessage
                data = ''
                if (event.method === undefined && event.id === message.id)
                    return event
            }
            throw new Error(
                `The ${name} MCP server ended its answer to ${message.method} without one.`,
            )
        },
        async close() {
            if (sessionId === null) return
            await fetch(url, {
                method: 'DELETE',
                headers: {
                    ...sent,
                    'mcp-session-id': sessionId,
                },
            })
                .then((answer) => answer.body?.cancel())
                .catch(() => {})
        },
    }
}
