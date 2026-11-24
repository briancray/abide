// ONE TURN OF THE CLAUDE CODE ON THIS MACHINE, run for a site and translated into the events abide's
// `assistant` yields. Claude Code runs its own loop; its tools are the site's, reached through the MCP
// server this bridge runs on loopback, and whatever built-in tools the visitor gave this bridge.
//
// THE SITE ASKS, THE VISITOR GRANTS (44.15, 44.16, 44.29). Every option is Claude Code's own, by name:
// a site's is laid on as its flag where it only shapes the answer, and its `tools` are a request the
// visitor's own `--tools` narrows (`grant.ts`). What reaches this machine — a user's settings, a
// project's CLAUDE.md, the files around it, its shell, the web from its network, its MCP servers — is
// the visitor's to give, on the bridge's command line, and nothing the site sends can. A bridge run
// `--full` (44.82) is given all of it, as `claude` run in an empty directory is.
//
// A TOOL OF THIS MACHINE IS APPROVED AS AUTO MODE DECIDES, and what it would ask is asked of the page
// (44.81): the site's own tools alone are approved without asking.

import type { ClaudeCodeConfig, ProviderEvent } from '@abide/abide/server'

import {
    type Grant,
    grantFor,
    PERMISSION_SERVER,
    SERVER_NAME,
    takeFlag,
    withheldNotices,
} from './grant.ts'
import { readLines } from './readLines.ts'
import { scratchDirectory } from './scratchDirectory.ts'

// Every tool of that server, as `--allowedTools` names them.
const SERVER_TOOLS = `mcp__${SERVER_NAME}`
const TOOL_PREFIX = `${SERVER_TOOLS}__`
/** The tool each permission prompt is asked of, as `--permission-prompt-tool` names it. 44.81. */
const PERMISSION_TOOL = `mcp__${PERMISSION_SERVER}__ask`

/** What the site asks of one turn: its one message, as Messages API blocks. */
export type TurnRequest = {
    id: string
    prompt: unknown[]
    config: ClaudeCodeConfig
    maxTurns: number
}

/** What a tool answered, as a `user` line carries it: its words, or blocks — an image as the API's or as MCP's. */
type Answered = {
    type: string
    text?: string
    source?: unknown
    data?: string
    mimeType?: string
}

type CodeLine = {
    type: string
    subtype?: string
    // The Messages API's own event, as Claude Code streamed it.
    event?: {
        type: string
        content_block?: { type: string; name?: string }
    }
    message?: {
        content:
            | string
            | {
                  type: string
                  tool_use_id?: string
                  content?: Answered[] | string
                  is_error?: boolean
              }[]
    }
    is_error?: boolean
    result?: string
}

type ResultContent = Extract<ProviderEvent, { type: 'tool_result' }>['content']

// 44.16 — the options a site may set: each only shapes the answer, and reaches nothing of this machine.
// Keyed by `ClaudeCodeConfig`'s own keys, so a key added on abide's side is a compile error here
// until it is decided whether a site may set it.
const SITE_OPTIONS = new Set(
    Object.keys({
        model: true,
        fallbackModel: true,
        systemPrompt: true,
        appendSystemPrompt: true,
        effort: true,
        maxBudgetUsd: true,
        betas: true,
        disallowedTools: true,
    } satisfies Record<keyof Omit<ClaudeCodeConfig, 'tools'>, true>),
)

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
 * Every flag but the protocol's: the site's, then auto mode, then the visitor's — so theirs wins where
 * two set one — and of a bridge not run `--full`, the tools the site asked for and the visitor granted
 * (44.29) and no setting source where the visitor named none. The site's own tools are approved
 * without asking, beside whatever the visitor's `--allowedTools` approves.
 * Beside them, what the site was given of this machine (`grantFor`).
 */
async function launchFlags(
    config: ClaudeCodeConfig,
    visitor: string[],
    full: boolean,
): Promise<{ flags: string[]; grant: Grant }> {
    const { tools: asked, ...options } = config
    // 44.82 — the visitor's options as they gave them, and Claude Code's own settings and servers.
    const { grant, args: given } = await grantFor(asked ?? [], visitor, full)
    const allowed = takeFlag(given, ['--allowedTools', '--allowed-tools'])
    const sources = full ? [] : takeFlag(given, ['--setting-sources'])
    const flags = [
        ...siteFlags(options),
        '--permission-mode',
        'auto',
        ...given,
        '--allowedTools',
        SERVER_TOOLS,
        ...(allowed ?? []),
    ]
    if (!full)
        flags.push(
            '--tools',
            grant.builtIn.join(','),
            '--setting-sources',
            (sources ?? []).join(','),
            '--strict-mcp-config',
        )
    return { flags, grant }
}

/** What a tool answered, as the Messages API's blocks for a `tool_result`: its words, and its images. */
function blocksOf(content: Answered[] | string | undefined): ResultContent {
    if (typeof content === 'string') return [{ type: 'text', text: content }]
    const blocks: ResultContent = []
    for (const piece of content ?? [])
        if (piece.type === 'text' && piece.text !== undefined)
            blocks.push({ type: 'text', text: piece.text })
        else if (piece.type === 'image' && piece.source !== undefined)
            blocks.push(piece as ResultContent[number])
        else if (piece.type === 'image' && piece.data !== undefined)
            blocks.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: piece.mimeType as 'image/png',
                    data: piece.data,
                },
            })
    return blocks
}

/**
 * The API's event as Claude Code streamed it, a call to one of the site's tools named as the site
 * lists it rather than as Claude Code's MCP server prefixes it. 44.2, 44.50.
 */
function siteNamed(event: NonNullable<CodeLine['event']>): ProviderEvent {
    const block = event.content_block
    if (
        event.type !== 'content_block_start' ||
        block?.type !== 'tool_use' ||
        block.name?.startsWith(TOOL_PREFIX) !== true
    )
        return event as ProviderEvent
    return {
        ...event,
        content_block: { ...block, name: block.name.slice(TOOL_PREFIX.length) },
    } as ProviderEvent
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
        /** Everything `claude` has is given, as by the native app's own bridge. 44.78, 44.82. */
        full: boolean
        /** The site's MCP server; the permission server is `${mcpUrl}/permission`. */
        mcpUrl: string
        signal: AbortSignal
        report: (event: ProviderEvent) => void
        say: (line: string) => void
    },
): Promise<void> {
    const { flags, grant } = await launchFlags(
        turn.config,
        options.claudeArgs,
        options.full,
    )
    if (!options.full)
        for (const notice of withheldNotices(grant)) options.say(notice)
    const { directory, remove } = await scratchDirectory()
    const config = `${directory}/mcp.json`
    await Bun.write(
        config,
        JSON.stringify({
            mcpServers: {
                // 44.82 — a full bridge's Claude Code reads the visitor's servers where `claude` would.
                ...(options.full ? {} : grant.servers),
                [SERVER_NAME]: { type: 'http', url: options.mcpUrl },
                [PERMISSION_SERVER]: {
                    type: 'http',
                    url: `${options.mcpUrl}/permission`,
                },
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
            '--permission-prompt-tool',
            PERMISSION_TOOL,
            '--mcp-config',
            config,
            '--max-turns',
            String(turn.maxTurns),
        ],
        cwd: directory,
        // The environment as it is NOW: without one, bun finds `claude` on the `PATH` the process
        // started with and hands the child that, where a native app assigns the login shell's after.
        env: { ...Bun.env },
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
            // 44.2 — each run as the API streamed it, event for event: Claude Code's partial
            // messages are the API's own events, and nothing is reshaped but a site tool's name.
            if (line.type === 'stream_event' && line.event !== undefined)
                options.report(siteNamed(line.event))
            // What a call answered, which Claude Code reports in the user message it sends back.
            else if (
                line.type === 'user' &&
                Array.isArray(line.message?.content)
            ) {
                for (const block of line.message.content)
                    if (block.type === 'tool_result')
                        options.report({
                            type: 'tool_result',
                            tool_use_id: block.tool_use_id as string,
                            content: blocksOf(block.content),
                            is_error: block.is_error === true,
                        })
            } else if (line.type === 'result') {
                // The turn cap ends the answer as `provider.claudeApi`'s does: a call left unanswered.
                if (line.subtype === 'error_max_turns') return
                if (line.is_error === true)
                    throw new Error(line.result ?? line.subtype ?? 'failed')
                return
            }
        }
        if (options.signal.aborted) return
        throw new Error(
            `claude exited ${await child.exited} with no result\n${(await stderr).slice(-2000)}`,
        )
    } finally {
        child.kill()
        await remove()
    }
}
