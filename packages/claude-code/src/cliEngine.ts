import type { AgentEngine } from '@abide/abide/server/agent'
import { appMcpServers } from './appMcpServers.ts'
import type { ClaudePermissions } from './ClaudePermissions.ts'
import { claudeCliArgs } from './claudeCliArgs.ts'
import { framesFromMessages } from './framesFromMessages.ts'
import { promptFromMessages } from './promptFromMessages.ts'
import type { StreamMessage } from './StreamMessage.ts'

type CliEngineConfig = {
    permissions?: ClaudePermissions
    /* Built-in tools the model may use, on top of the app's verbs. `[]` restricts
    it to only `mcp__<app>__*` (no shell/fs); omit to keep Claude's default set. */
    tools?: string[]
    mcpToken?: string
    systemPrompt?: string
    abortController?: AbortController
}

// Splits claude's stdout (JSONL stream-json) into parsed messages.
async function* readStreamJson(stdout: ReadableStream<Uint8Array>): AsyncIterable<StreamMessage> {
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
        const { value, done } = await reader.read()
        if (done) {
            break
        }
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (line) {
                yield JSON.parse(line) as StreamMessage
            }
            newline = buffer.indexOf('\n')
        }
    }
}

/*
A local-Claude engine: drives the user's installed `claude` binary headlessly
(`-p --output-format stream-json`) over the app's MCP, instead of the bundled SDK.
This is what keeps the serve bridge light — `bunx @abide/claude-code` needs only
Bun and the `claude` already on PATH, not @anthropic-ai/claude-agent-sdk. It maps
the same MCP contract (appMcpServers) and isolation (`--strict-mcp-config`,
`--setting-sources ''`) to CLI flags, and aborts — killing the child — when the
consumer stops iterating or the caller's controller fires.
*/
export function cliEngine(config: CliEngineConfig = {}): AgentEngine {
    return async function* ({ messages, origin }) {
        const servers = await appMcpServers(origin, config.mcpToken)
        const serverName = Object.keys(servers)[0]
        const controller = config.abortController ?? new AbortController()

        const args = [
            '-p',
            '--output-format',
            'stream-json',
            '--verbose',
            '--include-partial-messages',
            ...claudeCliArgs({ servers, permissions: config.permissions, headless: true }),
        ]
        /* tools `[]` (the serve default) → allow only the app's mcp tools; a list
        adds those built-ins; undefined keeps Claude's default toolset. */
        if (config.tools) {
            args.push('--allowedTools', ...config.tools, `mcp__${serverName}`)
        }
        if (config.systemPrompt) {
            args.push('--append-system-prompt', config.systemPrompt)
        }

        const child = Bun.spawn({
            cmd: ['claude', ...args],
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'inherit',
        })
        // Abort (e.g. serve's socket close) kills the spawned claude with the page.
        const onAbort = () => child.kill()
        controller.signal.addEventListener('abort', onAbort)
        // Await the write (it returns a Promise when backpressured) before closing,
        // so a prompt larger than the pipe buffer isn't truncated.
        await child.stdin.write(promptFromMessages(messages))
        await child.stdin.end()
        try {
            yield* framesFromMessages(readStreamJson(child.stdout))
        } finally {
            controller.signal.removeEventListener('abort', onAbort)
            child.kill()
        }
    }
}
