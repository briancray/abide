#!/usr/bin/env bun
// AN MCP SERVER OF THE VISITOR'S, over stdio, a line of JSON at a time: its one tool, `meetings`, answers
// the arguments it was given, where it runs and the directory's entries, and how many servers had
// started by the time it answered.
//
// Each start writes `<pid>.json` to `$FAKE_MCP_DIR`. A call with `wait: n` answers once `n` servers have
// started there, or 5 seconds on; one with `hang` never answers. It asks its client for its roots before
// it answers, as a server may, and says a line that is not JSON first.

import { readdir } from 'node:fs/promises' // bun has no directory listing of its own

import { readLines } from '../../../../bridge/src/readLines.ts'

const directory = process.env.FAKE_MCP_DIR as string
await Bun.write(
    `${directory}/${process.pid}.json`,
    JSON.stringify({ pid: process.pid, cwd: process.cwd() }),
)

const print = (message: unknown): void => {
    process.stdout.write(`${JSON.stringify(message)}\n`)
}
process.stdout.write('starting up\n')

const started = async (): Promise<number> =>
    (await readdir(directory)).filter((name) => name.endsWith('.json')).length

for await (const line of readLines(Bun.stdin.stream())) {
    if (line === '') continue
    const message = JSON.parse(line) as {
        id?: number | string
        method?: string
        params?: { name?: string; arguments?: Record<string, unknown> }
    }
    if (message.method === 'initialize')
        print({
            jsonrpc: '2.0',
            id: message.id,
            result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'calendar', version: '1' },
            },
        })
    else if (message.method === 'tools/call') {
        const input = message.params?.arguments ?? {}
        if (input.hang === true) continue
        print({ jsonrpc: '2.0', id: 'roots', method: 'roots/list' })
        if (message.params?.name !== 'meetings') {
            print({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                    code: -32602,
                    message: `No tool ${message.params?.name}.`,
                },
            })
            continue
        }
        const until = Date.now() + 5_000
        while (
            (await started()) < Number(input.wait ?? 0) &&
            Date.now() < until
        )
            await Bun.sleep(20)
        print({
            jsonrpc: '2.0',
            id: message.id,
            result: {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            input,
                            cwd: process.cwd(),
                            entries: await readdir(process.cwd()),
                            started: await started(),
                        }),
                    },
                ],
                isError: false,
            },
        })
    }
}

export {}
