#!/usr/bin/env bun
// A CLAUDE CODE THAT PLAYS THE SAME CONVERSATION as `fakeMessagesApi.ts`, in `stream-json`: it calls
// `invoices_whoami` through the MCP server its `--mcp-config` names — the bridge's, on loopback — and
// says what the tool answered.
//
// It records what it was run with to `$FAKE_RECORD` — its arguments, the prompt, its pid, and the
// config — and a prompt holding `hang` prints one line and then waits to be killed.

const args = process.argv.slice(2)
const configPath = args[args.indexOf('--mcp-config') + 1] as string
const config = (await Bun.file(configPath).json()) as {
    mcpServers: { app: { url: string } }
}
let input = ''
for await (const chunk of Bun.stdin.stream())
    input += new TextDecoder().decode(chunk)
const prompt = (JSON.parse(input.trim()) as { message: { content: string } })
    .message.content

await Bun.write(
    process.env.FAKE_RECORD as string,
    JSON.stringify({ args, prompt, pid: process.pid, configPath, config }),
)

const print = (line: unknown): void => {
    process.stdout.write(`${JSON.stringify(line)}\n`)
}
const text = (value: string): void =>
    print({
        type: 'stream_event',
        event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: value },
        },
    })

print({ type: 'system', subtype: 'init' })
text('checking')
if (prompt.includes('hang')) await new Promise(() => {})

print({
    type: 'assistant',
    message: {
        content: [
            {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'mcp__app__invoices_whoami',
                input: {},
            },
        ],
    },
})
const server = config.mcpServers.app
const answered = (await (
    await fetch(server.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'invoices_whoami', arguments: {} },
        }),
    })
).json()) as {
    result: { content: { type: string; text: string }[]; isError: boolean }
}
const said = answered.result.content[0]?.text as string
print({
    type: 'user',
    message: {
        content: [
            {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: answered.result.content,
                is_error: answered.result.isError,
            },
        ],
    },
})
text(`saw ${said}`)
print({
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
    usage: { input_tokens: 3, output_tokens: 5 },
})

export {}
