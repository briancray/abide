#!/usr/bin/env bun
// A CLAUDE CODE THAT PLAYS THE SAME CONVERSATION as `fakeMessagesApi.ts`, in `stream-json`: it calls
// `post_invoices_whoami` through the MCP server its `--mcp-config` names — the bridge's, on loopback — and
// says what the tool answered.
//
// It records what it was run with to `$FAKE_RECORD` — its arguments, the prompt, its pid, and the
// config — and a prompt holding `hang` prints one line and then waits to be killed, one holding `writing`
// starts the tool call and then waits. A prompt holding `record` adds the MCP server's whole reply to the
// tool call to the record, and ends there. A prompt holding `permission` first asks the server
// `--permission-prompt-tool` names whether `Bash` may run `ls`, and says what it was answered — or,
// holding `record` too, records that answer in place of the tool call's, and ends there.

const args = process.argv.slice(2)
// The bridge's own, last: a visitor's may precede it (44.82).
const configPath = args[args.lastIndexOf('--mcp-config') + 1] as string
const config = (await Bun.file(configPath).json()) as {
    mcpServers: Record<string, { url: string }>
}
let input = ''
for await (const chunk of Bun.stdin.stream())
    input += new TextDecoder().decode(chunk)
const prompt = (
    JSON.parse(input.trim()) as { message: { content: { text?: string }[] } }
).message.content
// The prompt's words, which the cases below look for.
const words = prompt.map((block) => block.text ?? '').join('')

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
if (words.includes('hang')) await new Promise(() => {})

/** One JSON-RPC request to the MCP server `server` of the config, answered. */
async function rpc(
    server: string,
    id: number,
    method: string,
    params: unknown,
): Promise<{ result: { content: { type: string; text: string }[] } }> {
    const answer = await fetch(config.mcpServers[server]?.url as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    return (await answer.json()) as never
}

if (words.includes('permission')) {
    // `mcp__<server>__<tool>`: the server is the name between the prefix and the last `__`.
    const named = args[args.indexOf('--permission-prompt-tool') + 1] as string
    const server = named.slice('mcp__'.length, named.lastIndexOf('__'))
    const listed = await rpc(server, 1, 'tools/list', {})
    const asked = await rpc(server, 2, 'tools/call', {
        name: named.slice(named.lastIndexOf('__') + 2),
        arguments: {
            tool_name: 'Bash',
            input: { command: 'ls' },
            tool_use_id: 'toolu_0',
        },
    })
    if (words.includes('record')) {
        await Bun.write(
            process.env.FAKE_RECORD as string,
            JSON.stringify({
                args,
                prompt,
                pid: process.pid,
                listed,
                reply: asked,
            }),
        )
        print({ type: 'result', subtype: 'success', stop_reason: 'end_turn' })
        process.exit(0)
    }
    text(`permission ${asked.result.content[0]?.text}`)
}

print({
    type: 'stream_event',
    event: {
        type: 'content_block_start',
        index: 1,
        content_block: {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'mcp__app__post_invoices_whoami',
            input: {},
        },
    },
})
if (words.includes('writing')) await new Promise(() => {})
print({
    type: 'assistant',
    message: {
        content: [
            {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'mcp__app__post_invoices_whoami',
                input: {},
            },
        ],
    },
})
const server = config.mcpServers.app as { url: string }
const replied = await (
    await fetch(server.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'post_invoices_whoami', arguments: {} },
        }),
    })
).json()
if (words.includes('record')) {
    await Bun.write(
        process.env.FAKE_RECORD as string,
        JSON.stringify({ args, prompt, pid: process.pid, reply: replied }),
    )
    print({ type: 'result', subtype: 'success', stop_reason: 'end_turn' })
    process.exit(0)
}
const answered = replied as {
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
