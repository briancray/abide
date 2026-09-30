// ONE TURN OF THE CLAUDE CODE ON THIS MACHINE, run for a site and translated into the events abide's
// `assistant` yields. Claude Code runs its own loop; its tools are the site's, reached through the MCP
// server this bridge runs on loopback, and nothing else.
//
// ITS OWN TOOLS OFF, NO SETTINGS READ, NO MCP SERVER BUT THE BRIDGE'S, IN AN EMPTY DIRECTORY: the site
// chose the prompt, and nothing of this machine — a user's settings, a project's CLAUDE.md, the files
// around it, its shell — is the site's to reach. None of that is something the site can ask for.

import { mkdtemp, rm } from 'node:fs/promises' // bun has no temporary directory or recursive remove of its own
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own
import type { AssistantEvent, ClaudeCodeConfig } from 'abide/server'
import { readLines } from './readLines.ts'

// What Claude Code names the one MCP server it is handed, and so the prefix on each tool it calls.
const SERVER_NAME = 'app'
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`

/** What the site asks of one turn. */
export type TurnRequest = {
    id: string
    prompt: string
    config: ClaudeCodeConfig
    maxTurns: number
}

type Usage = {
    input_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    output_tokens?: number
}

type McpContent = { type: string; text?: string }

type CodeLine = {
    type: string
    subtype?: string
    event?: { type: string; delta?: { type: string; text?: string } }
    message?: {
        content:
            | string
            | {
                  type: string
                  id?: string
                  name?: string
                  input?: unknown
                  tool_use_id?: string
                  content?: McpContent[] | string
                  is_error?: boolean
              }[]
    }
    stop_reason?: string | null
    is_error?: boolean
    result?: string
    usage?: Usage
}

/** The flags that carry what a site may set, in Claude Code's own spelling. */
function configFlags(config: ClaudeCodeConfig): string[] {
    const flags: string[] = []
    if (config.model !== undefined) flags.push('--model', config.model)
    if (config.fallbackModel !== undefined)
        flags.push('--fallback-model', config.fallbackModel)
    if (config.systemPrompt !== undefined)
        flags.push('--system-prompt', config.systemPrompt)
    if (config.appendSystemPrompt !== undefined)
        flags.push('--append-system-prompt', config.appendSystemPrompt)
    if (config.effort !== undefined) flags.push('--effort', config.effort)
    return flags
}

function textOf(content: McpContent[] | string | undefined): string {
    if (typeof content === 'string') return content
    let text = ''
    for (const part of content ?? [])
        if (part.text !== undefined) text += part.text
    return text
}

function done(stop: string, usage: Usage | undefined): AssistantEvent {
    return {
        type: 'done',
        stop,
        usage: {
            input:
                (usage?.input_tokens ?? 0) +
                (usage?.cache_creation_input_tokens ?? 0) +
                (usage?.cache_read_input_tokens ?? 0),
            output: usage?.output_tokens ?? 0,
        },
    }
}

/**
 * Runs `turn` with `claude`, reporting each event, until Claude Code ends it or `signal` does.
 *
 * Throws where Claude Code fails, with what it said.
 */
export async function claudeTurn(
    turn: TurnRequest,
    options: {
        claude: string
        mcpUrl: string
        signal: AbortSignal
        report: (event: AssistantEvent) => void
    },
): Promise<void> {
    const directory = await mkdtemp(`${tmpdir()}/abide-bridge-`)
    const config = `${directory}/mcp.json`
    await Bun.write(
        config,
        JSON.stringify({
            mcpServers: {
                [SERVER_NAME]: { type: 'http', url: options.mcpUrl },
            },
        }),
    )
    const child = Bun.spawn({
        cmd: [
            options.claude,
            '-p',
            '--input-format',
            'stream-json',
            '--output-format',
            'stream-json',
            '--verbose',
            '--include-partial-messages',
            '--no-session-persistence',
            '--tools',
            '',
            '--setting-sources',
            '',
            '--strict-mcp-config',
            '--mcp-config',
            config,
            '--allowedTools',
            TOOL_PREFIX.slice(0, -2),
            '--max-turns',
            String(turn.maxTurns),
            ...configFlags(turn.config),
        ],
        cwd: directory,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        signal: options.signal,
    })
    child.stdin.write(
        `${JSON.stringify({ type: 'user', message: { role: 'user', content: turn.prompt } })}\n`,
    )
    child.stdin.end()
    const stderr = new Response(child.stderr).text()
    try {
        for await (const text of readLines(child.stdout)) {
            if (text === '') continue
            const line = JSON.parse(text) as CodeLine
            if (line.type === 'stream_event') {
                const delta = line.event?.delta
                if (
                    line.event?.type === 'content_block_delta' &&
                    delta?.type === 'text_delta'
                )
                    options.report({ type: 'text', text: delta.text as string })
            } else if (
                (line.type === 'assistant' || line.type === 'user') &&
                Array.isArray(line.message?.content)
            ) {
                for (const block of line.message.content)
                    if (block.type === 'tool_use')
                        options.report({
                            type: 'tool',
                            id: block.id as string,
                            name: (block.name as string).replace(
                                TOOL_PREFIX,
                                '',
                            ),
                            input: block.input,
                        })
                    else if (block.type === 'tool_result')
                        options.report({
                            type: 'result',
                            id: block.tool_use_id as string,
                            text: textOf(block.content),
                            failed: block.is_error === true,
                        })
            } else if (line.type === 'result') {
                // The turn cap is one stop, whichever provider reached it.
                if (line.subtype === 'error_max_turns') {
                    options.report(done('max_turns', line.usage))
                    return
                }
                if (line.is_error === true)
                    throw new Error(line.result ?? line.subtype ?? 'failed')
                options.report(done(line.stop_reason ?? 'end_turn', line.usage))
                return
            }
        }
        if (options.signal.aborted) return
        throw new Error(
            `claude exited ${await child.exited} with no result\n${(await stderr).slice(-2000)}`,
        )
    } finally {
        child.kill()
        await rm(directory, { recursive: true, force: true })
    }
}
