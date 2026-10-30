// ONE TURN OF THE CLAUDE CODE ON THIS MACHINE, run for a site and translated into the events abide's
// `assistant` yields. Claude Code runs its own loop; its tools are the site's, reached through the MCP
// server this bridge runs on loopback, and whatever built-in tools the visitor gave this bridge.
//
// THE SITE ASKS, THE VISITOR GRANTS (44.15, 44.16, 44.29). Every option is Claude Code's own, by name:
// a site's is laid on as its flag where it only shapes the answer, and its `tools` are a request the
// visitor's own `--tools` narrows. What reaches this machine — a user's settings, a project's
// CLAUDE.md, the files around it, its shell, the web from its network — is the visitor's to give, on
// the bridge's command line, and nothing the site sends can.

import { mkdtemp, rm } from 'node:fs/promises' // bun has no temporary directory or recursive remove of its own
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import type { AssistantEvent, ClaudeCodeConfig } from '@abide/abide/server'

import { readLines } from './readLines.ts'

// What Claude Code names the one MCP server it is handed, and so the prefix on each tool it calls.
const SERVER_NAME = 'app'
// Every tool of that server, as `--allowedTools` names them.
const SERVER_TOOLS = `mcp__${SERVER_NAME}`
const TOOL_PREFIX = `${SERVER_TOOLS}__`

/** What the site asks of one turn: its one message, as Messages API blocks. */
export type TurnRequest = {
    id: string
    prompt: unknown[]
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
    event?: {
        type: string
        delta?: { type: string; text?: string }
        content_block?: { type: string; id?: string; name?: string }
    }
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

// 44.16 — the options a site may set: each only shapes the answer, and reaches nothing of this machine.
const SITE_OPTIONS = new Set([
    'model',
    'fallbackModel',
    'systemPrompt',
    'appendSystemPrompt',
    'effort',
    'maxBudgetUsd',
    'betas',
    'disallowedTools',
])

/** Claude Code's flag for an option named in camelCase: `fallbackModel` is `--fallback-model`. */
function flagOf(option: string): string {
    return `--${option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

/**
 * The flags carrying what a site set, in Claude Code's own spelling, a list's values comma-joined.
 *
 * Throws where the site set an option it may not (44.16).
 */
function siteFlags(config: Omit<ClaudeCodeConfig, 'tools'>): string[] {
    const flags: string[] = []
    for (const option in config) {
        // Read as it arrived: the site's config is JSON, whatever its type said.
        const value: unknown = config[option as keyof typeof config]
        if (value === undefined) continue
        if (!SITE_OPTIONS.has(option))
            throw new Error(
                `This bridge takes no \`${option}\` from a site (44.16): what reaches the visitor's machine is theirs to pass to abide-bridge.`,
            )
        flags.push(
            flagOf(option),
            Array.isArray(value) ? value.join(',') : String(value),
        )
    }
    return flags
}

/**
 * The values the visitor gave a flag by any of its `spellings` — `--flag a b`, `--flag a,b` or
 * `--flag=a` — taken out of `args`, or `undefined` where they never gave it.
 */
function takeFlag(args: string[], spellings: string[]): string[] | undefined {
    let values: string[] | undefined
    for (let index = 0; index < args.length;) {
        const arg = args[index] as string
        const [flag, inline] = arg.split(/=(.*)/s) as [string, string?]
        if (!spellings.includes(flag)) {
            index++
            continue
        }
        values ??= []
        if (inline !== undefined) {
            values.push(inline)
            args.splice(index, 1)
        } else {
            let end = index + 1
            while (end < args.length && !(args[end] as string).startsWith('-'))
                end++
            values.push(...args.slice(index + 1, end))
            args.splice(index, end - index)
        }
    }
    return values
}

/**
 * Every flag but the protocol's: the site's, then the visitor's — so theirs wins where both set one —
 * then the built-in tools both named (44.29), and no setting source where the visitor named none.
 * Beside them, the tools the site asked for that the visitor did not give.
 */
function launchFlags(
    config: ClaudeCodeConfig,
    visitor: string[],
): { flags: string[]; ungranted: string[] } {
    const { tools: asked, ...options } = config
    const args = [...visitor]
    const granted = new Set<string>()
    for (const value of takeFlag(args, ['--tools']) ?? [])
        for (const tool of value.split(/[\s,]+/)) granted.add(tool)
    const allowed = takeFlag(args, ['--allowedTools', '--allowed-tools'])
    const sources = takeFlag(args, ['--setting-sources']) ?? []
    const tools: string[] = []
    const ungranted: string[] = []
    for (const tool of asked ?? [])
        (granted.has(tool) ? tools : ungranted).push(tool)
    const flags = [
        ...siteFlags(options),
        ...args,
        '--tools',
        tools.join(','),
        // The site's own tools are always approved; a built-in one is approved as granted, unless
        // the visitor said which calls of it are.
        '--allowedTools',
        SERVER_TOOLS,
        ...(allowed ?? tools),
        '--setting-sources',
        sources.join(','),
    ]
    return { flags, ungranted }
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
        claudeArgs: string[]
        mcpUrl: string
        signal: AbortSignal
        report: (event: AssistantEvent) => void
        say: (line: string) => void
    },
): Promise<void> {
    const { flags, ungranted } = launchFlags(turn.config, options.claudeArgs)
    if (ungranted.length > 0)
        options.say(
            `The site asked for ${ungranted.join(', ')}, which this bridge was not given. Run it with \`-- --tools ${ungranted.join(',')}\` to allow it.`,
        )
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
            ...flags,
            // The protocol's own, last so that nothing before them overrides one.
            '-p',
            '--input-format',
            'stream-json',
            '--output-format',
            'stream-json',
            '--verbose',
            '--include-partial-messages',
            '--no-session-persistence',
            '--strict-mcp-config',
            '--mcp-config',
            config,
            '--max-turns',
            String(turn.maxTurns),
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
                const started = line.event?.content_block
                if (
                    line.event?.type === 'content_block_delta' &&
                    delta?.type === 'text_delta'
                )
                    options.report({ type: 'text', text: delta.text as string })
                // 44.28 — the call is announced as the model starts writing it, its input once written.
                else if (
                    line.event?.type === 'content_block_start' &&
                    started?.type === 'tool_use'
                )
                    options.report({
                        type: 'tool',
                        id: started.id as string,
                        name: (started.name as string).replace(TOOL_PREFIX, ''),
                    })
            } else if (
                (line.type === 'assistant' || line.type === 'user') &&
                Array.isArray(line.message?.content)
            ) {
                for (const block of line.message.content)
                    if (block.type === 'tool_use')
                        options.report({
                            type: 'input',
                            id: block.id as string,
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
