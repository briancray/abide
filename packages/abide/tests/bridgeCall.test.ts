// 44.93-44.98 — `provider.claudeCode.callTool` over a served app, through a real `abide-bridge` paired
// with it: one MCP tool of the visitor's machine called with no Claude Code run, on a server the
// bridge starts for that call alone (`fixtures/assistant/fakeMcpServer.ts`), and only where the
// visitor's own options give the site the tool and approve it.

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { mkdir, readdir, rm } from 'node:fs/promises' // bun has no directory listing or recursive remove of its own

import { handlerFiles, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const FIXTURES = new URL('./fixtures/assistant/', import.meta.url).pathname
const FAKE_MCP = `${FIXTURES}fakeMcpServer.ts`
const BRIDGE = new URL('../../bridge/', import.meta.url).pathname
// A scripted Claude Code that records each run to `RECORD`: a call runs none.
const FAKE_CLAUDE = `${FIXTURES}fakeClaudeCode.ts`
const RECORD = `${Bun.env.TMPDIR ?? '/tmp'}/abide-bridge-call-${process.pid}.json`
const SCRATCH: string[] = []

const HANDLERS = `import { GET, POST, provider } from '@abide/abide/server'

const HIDDEN = { clients: { mcp: false } }

export const command = GET(() => provider.claudeCode.bridgeCommand(), HIDDEN)

export const call = POST(({ tool, input }: { tool: string; input: unknown }) => provider.claudeCode.callTool(tool, input), HIDDEN)
`

let base = ''
let stop = (): void => {}
const bridges: Bun.Subprocess[] = []
let environment: Record<string, string | undefined> = process.env

beforeAll(async () => {
    environment = {
        ...process.env,
        ABIDE_PRINCIPAL_SECRET: 'bridge-call-test-secret',
        FAKE_RECORD: RECORD,
    }
    ;({ base, stop } = await serveApp(
        {
            'index.abide': '<main>home</main>',
            ...handlerFiles('', HANDLERS),
        },
        environment,
    ))
}, 30_000)

afterEach(() => {
    for (const running of bridges.splice(0)) running.kill()
})

afterAll(async () => {
    for (const directory of SCRATCH)
        await rm(directory, { recursive: true, force: true })
    stop()
    removeTemporaryModules()
})

function asPage(caller: string): Record<string, string> {
    return { cookie: `abide-caller=${caller}` }
}

async function pairingCode(caller: string): Promise<string> {
    const answer = await Bun.fetch(`${base}/command`, {
        headers: asPage(caller),
    })
    const { command } = (await answer.json()) as { command: string }
    return command.split(' ').at(-1) as string
}

/** A bridge paired with `caller`, run with `claudeArgs` after its `--`, once it has said it connected. */
async function pairBridge(
    caller: string,
    claudeArgs: string[],
): Promise<Bun.Subprocess> {
    const running = Bun.spawn(
        [
            'bun',
            `${BRIDGE}bin/abideBridge.ts`,
            base,
            await pairingCode(caller),
            '--claude',
            FAKE_CLAUDE,
            '--',
            ...claudeArgs,
        ],
        { stderr: 'pipe', env: environment },
    )
    bridges.push(running)
    const reader = (running.stderr as ReadableStream<Uint8Array>).getReader()
    const said = new TextDecoder().decode((await reader.read()).value)
    reader.releaseLock()
    if (!said.startsWith('Connected'))
        throw new Error(`the bridge did not connect: ${said}`)
    return running
}

/**
 * A directory the visitor's servers record their starts in, and an `--mcp-config` beside it holding
 * `calendar` — the fake server over stdio — and whatever `others` adds.
 */
async function visitorServers(
    others: Record<string, unknown> = {},
): Promise<{ directory: string; config: string }> {
    const directory = `${Bun.env.TMPDIR ?? '/tmp'}/abide-bridge-call-${process.pid}-${crypto.randomUUID()}`
    await mkdir(`${directory}/started`, { recursive: true })
    SCRATCH.push(directory)
    const config = `${directory}/servers.json`
    await Bun.write(
        config,
        JSON.stringify({
            mcpServers: {
                calendar: {
                    command: 'bun',
                    args: [FAKE_MCP],
                    env: { FAKE_MCP_DIR: `${directory}/started` },
                },
                ...others,
            },
        }),
    )
    return { directory, config }
}

function call(
    caller: string,
    tool: string,
    input: unknown,
    signal?: AbortSignal,
): Promise<Response> {
    return Bun.fetch(`${base}/call`, {
        method: 'POST',
        headers: { ...asPage(caller), 'content-type': 'application/json' },
        body: JSON.stringify({ tool, input }),
        signal: signal ?? null,
    })
}

/** What the fake `meetings` tool answered, read from the `ToolAnswer` a call answered with. */
async function meetingsAnswer(answer: Response): Promise<{
    input: unknown
    cwd: string
    entries: string[]
    started: number
}> {
    const text = await answer.text()
    if (answer.status !== 200) throw new Error(`${answer.status}: ${text}`)
    const { content, failed } = JSON.parse(text) as {
        content: { type: string; text: string }[]
        failed: boolean
    }
    expect(failed).toBe(false)
    return JSON.parse(content[0]?.text as string)
}

// 44.93, 44.95 — A CALL RUNS THE TOOL AND NO MODEL: its answer is the tool's, as a `ToolAnswer`, with
// no Claude Code run (the scripted one records nothing), on a server started for it in an empty
// directory that is gone once the call is answered — a request of the server's own and a line that is
// not JSON in between notwithstanding. THE REVERT: drop the `rm` of the session's directory, and the
// directory is still there.
test('a call answers what the tool answered, with no Claude Code run — 44.93, 44.95', async () => {
    const { config } = await visitorServers()
    await pairBridge('called', [
        '--mcp-config',
        config,
        '--tools',
        'mcp__calendar__meetings',
    ])
    const answered = await meetingsAnswer(
        await call('called', 'mcp__calendar__meetings', { day: 'monday' }),
    )
    expect(answered.input).toEqual({ day: 'monday' })
    expect(await Bun.file(RECORD).exists()).toBe(false)
    expect(answered.entries).toEqual([])
    expect(
        await readdir(answered.cwd).then(
            () => 'there',
            () => 'gone',
        ),
    ).toBe('gone')
}, 30_000)

// 44.93 — NOTHING PAIRED IS REFUSED 409, before any bridge is asked.
test('a call with nothing paired is refused 409 — 44.93', async () => {
    await pairingCode('nobody')
    const answer = await call('nobody', 'mcp__calendar__meetings', {})
    expect(answer.status).toBe(409)
    await answer.text()
})

// 44.94 — A CALL IS BOUNDED BY THE GRANT A TURN NAMING ITS TOOL ALONE WOULD HAVE, AND BY THE
// VISITOR'S `--disallowedTools`. Approved by `--allowedTools` but not granted, granted and then
// disallowed, a tool of a server the visitor has none of, a built-in tool granted, and a name that is
// a whole server: each refused 403, and no server is ever started.
//
// THE REVERT: call `grantFor` as if the bridge ran full, and the first answers 200.
test('a call of a tool the visitor did not give is refused 403 — 44.94', async () => {
    const { directory, config } = await visitorServers()
    const refused = async (
        caller: string,
        claudeArgs: string[],
        tool: string,
    ): Promise<number> => {
        await pairBridge(caller, ['--mcp-config', config, ...claudeArgs])
        const answer = await call(caller, tool, {})
        await answer.text()
        return answer.status
    }
    expect(
        await refused(
            'ungranted',
            ['--allowedTools', 'mcp__calendar__meetings'],
            'mcp__calendar__meetings',
        ),
    ).toBe(403)
    expect(
        await refused(
            'disallowed',
            [
                '--tools',
                'mcp__calendar',
                '--disallowedTools',
                'mcp__calendar__meetings',
            ],
            'mcp__calendar__meetings',
        ),
    ).toBe(403)
    expect(
        await refused('unserved', ['--tools', 'mcp__mail'], 'mcp__mail__send'),
    ).toBe(403)
    expect(await refused('built-in', ['--tools', 'Bash'], 'Bash')).toBe(403)
    expect(
        await refused('whole', ['--tools', 'mcp__calendar'], 'mcp__calendar'),
    ).toBe(403)
    expect(await readdir(`${directory}/started`)).toEqual([])
}, 60_000)

// 44.94 — THE GRANT ALONE MAKES A CALL: a server's every tool, given by `mcp__<server>`, with no
// `--allowedTools`, since a turn's prompt is the site's to answer (44.83) and a call asks nothing
// past the grant. THE REVERT: refuse a call whose tool `--allowedTools` does not name, and this
// answers 403 where 200 is due.
test('a call of a tool whose server the visitor gave is made — 44.94', async () => {
    const { config } = await visitorServers()
    await pairBridge('server', [
        '--mcp-config',
        config,
        '--tools',
        'mcp__calendar',
    ])
    expect(
        (
            await meetingsAnswer(
                await call('server', 'mcp__calendar__meetings', {}),
            )
        ).input,
    ).toEqual({})
}, 30_000)

// 44.97 — CALLS ARE MADE SIDE BY SIDE: each `meetings` answers only once both servers have started, so
// a bridge making one call at a time answers the first after its wait with one server started.
// THE REVERT: await each call in `take`, one frame at a time, and the first answers `started: 1`.
test('a bridge makes each call as it is sent — 44.97', async () => {
    const { config } = await visitorServers()
    await pairBridge('together', [
        '--mcp-config',
        config,
        '--tools',
        'mcp__calendar__meetings',
    ])
    const both = await Promise.all([
        call('together', 'mcp__calendar__meetings', { wait: 2 }).then(
            meetingsAnswer,
        ),
        call('together', 'mcp__calendar__meetings', { wait: 2 }).then(
            meetingsAnswer,
        ),
    ])
    expect(both.map((answered) => answered.started)).toEqual([2, 2])
}, 30_000)

// 44.98 — A CALLER WHO HANGS UP ENDS THE CALL: the server of a call that never answers is ended once
// the page's request is. THE REVERT: drop the `cancel` frame `runCall` sends on abort, and the
// server's pid still answers a signal 0.
test('a caller hanging up ends the call — 44.98', async () => {
    const { directory, config } = await visitorServers()
    await pairBridge('hangs', [
        '--mcp-config',
        config,
        '--tools',
        'mcp__calendar__meetings',
    ])
    const hangUp = new AbortController()
    const answer = call(
        'hangs',
        'mcp__calendar__meetings',
        { hang: true },
        hangUp.signal,
    ).catch(() => undefined)
    let started: string[] = []
    for (let tries = 0; started.length === 0 && tries < 100; tries++) {
        await Bun.sleep(50)
        started = await readdir(`${directory}/started`)
    }
    const { pid } = (await Bun.file(
        `${directory}/started/${started[0]}`,
    ).json()) as { pid: number }
    // Answered by the time the file is written? A beat for the server to reach its call.
    await Bun.sleep(200)
    hangUp.abort()
    await answer
    let alive = true
    for (let tries = 0; alive && tries < 100; tries++) {
        await Bun.sleep(50)
        try {
            process.kill(pid, 0)
        } catch {
            alive = false
        }
    }
    expect(alive).toBe(false)
}, 30_000)

// 44.95 — A SERVER AT AN HTTP ADDRESS is sent the headers its configuration names and nothing of the
// page's, its session carried, and its answer read out of an event stream; a call it answers 401 is
// made by a turn (44.99). THE REVERT: read the answer as JSON whatever its type, and the first call
// is made by the turn, answering `called {"lane":2}`; drop `helpedHeaders`, and the helped one
// answers `called {"lane":3}`.
test('a call reaches an http server with its own headers alone — 44.95', async () => {
    const seen: Record<string, string | null>[] = []
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            if (request.headers.get('x-key') !== 'visitor-key')
                return new Response(null, { status: 401 })
            seen.push({
                method: request.method,
                session: request.headers.get('mcp-session-id'),
                cookie: request.headers.get('cookie'),
            })
            if (request.method === 'DELETE') return new Response(null)
            const message = (await request.json()) as {
                id?: number
                method: string
                params?: { arguments?: unknown }
            }
            if (message.id === undefined)
                return new Response(null, { status: 202 })
            if (message.method === 'initialize')
                return Response.json(
                    {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: {
                            protocolVersion: '2025-06-18',
                            capabilities: {},
                        },
                    },
                    { headers: { 'mcp-session-id': 'session-1' } },
                )
            const said = `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\ndata: ${JSON.stringify(
                {
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(message.params?.arguments),
                            },
                        ],
                    },
                },
            )}\n\n`
            return new Response(said, {
                headers: { 'content-type': 'text/event-stream' },
            })
        },
    })
    try {
        const url = `http://127.0.0.1:${server.port}/mcp`
        const { config } = await visitorServers({
            board: { type: 'http', url, headers: { 'x-key': 'visitor-key' } },
            locked: { type: 'http', url },
            helped: {
                type: 'http',
                url,
                headers: { 'x-key': 'stale-key' },
                headersHelper: `printf '{"x-key":"visitor-key"}'`,
            },
        })
        await pairBridge('http', [
            '--mcp-config',
            config,
            '--tools',
            'mcp__board,mcp__locked,mcp__helped',
        ])
        const answer = await call('http', 'mcp__board__cards', { lane: 2 })
        expect(answer.status).toBe(200)
        expect(await answer.json()).toEqual({
            content: [{ type: 'text', text: '{"lane":2}' }],
            failed: false,
        })
        expect(seen.map((one) => one.method)).toEqual([
            'POST',
            'POST',
            'POST',
            'DELETE',
        ])
        expect(seen.slice(1).map((one) => one.session)).toEqual([
            'session-1',
            'session-1',
            'session-1',
        ])
        expect(seen.every((one) => one.cookie === null)).toBe(true)
        // 44.99 — refused for want of a sign-in, it is made by a turn instead.
        const locked = await call('http', 'mcp__locked__cards', {})
        expect(locked.status).toBe(200)
        expect(await locked.json()).toEqual({
            content: [{ type: 'text', text: 'called {}' }],
            failed: false,
        })
        // What its `headersHelper` writes is sent over what its `headers` name, so the call is
        // made rather than refused 401 and handed to a turn.
        const helped = await call('http', 'mcp__helped__cards', { lane: 3 })
        expect(await helped.json()).toEqual({
            content: [{ type: 'text', text: '{"lane":3}' }],
            failed: false,
        })
    } finally {
        server.stop(true)
    }
}, 30_000)

// 44.96, 44.99 — A BRIDGE THAT NEVER SAID IT MAKES CALLS — an older release — is sent a turn that
// makes it at once, rather than a call it would never answer. Paired here by hand, as such a bridge
// pairs. THE REVERT: drop the `calls` check from `runCall`, and it is sent a `call` frame instead.
test('a call to a bridge that never said it makes calls is sent as a turn — 44.96, 44.99', async () => {
    const code = await pairingCode('old')
    const stream = await Bun.fetch(`${base}/__abide/bridge?code=${code}`, {
        headers: { accept: 'text/event-stream' },
    })
    expect(stream.status).toBe(200)
    const hangUp = new AbortController()
    const answer = call(
        'old',
        'mcp__calendar__meetings',
        { day: 'monday' },
        hangUp.signal,
    ).catch(() => undefined)
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let read = ''
    let sent: { type: string; config?: unknown } | undefined
    try {
        while (sent === undefined) {
            const { value, done } = await reader.read()
            if (done) break
            read += decoder.decode(value, { stream: true })
            for (const line of read.split('\n'))
                if (line.startsWith('data:') && line.includes('"id"')) {
                    const frame = JSON.parse(line.slice(5)) as { type: string }
                    if (frame.type === 'turn' || frame.type === 'call')
                        sent = frame
                }
        }
        expect(sent?.type).toBe('turn')
        expect(sent?.config).toEqual({
            model: 'haiku',
            effort: 'low',
            tools: ['mcp__calendar__meetings'],
        })
    } finally {
        hangUp.abort()
        await answer
        await reader.cancel()
    }
}, 30_000)

// 44.99 — A CALL THE BRIDGE COULD NOT MAKE IS MADE BY A TURN, and answers the tool's answer, not the
// model's: a server that cannot be started, called through the scripted Claude Code, which answers
// the call and then talks on forever — so the run has to be ended at the tool's answer, and is.
// THE REVERT: end the run after leaving the turn rather than before, and the scripted Claude Code is
// still running once the call has answered.
test('a call the bridge could not make is made by a turn, ended at its answer — 44.99', async () => {
    const { config } = await visitorServers({
        broken: { command: '/nonexistent/server' },
    })
    await pairBridge('fallback', [
        '--mcp-config',
        config,
        '--tools',
        'mcp__broken',
    ])
    const answer = await call('fallback', 'mcp__broken__meetings', {
        day: 'monday',
    })
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({
        content: [{ type: 'text', text: 'called {"day":"monday"}' }],
        failed: false,
    })
    const { args, pid } = (await Bun.file(RECORD).json()) as {
        args: string[]
        pid: number
    }
    expect(args[args.indexOf('--model') + 1]).toBe('haiku')
    let alive = true
    for (let tries = 0; alive && tries < 100; tries++) {
        await Bun.sleep(50)
        try {
            process.kill(pid, 0)
        } catch {
            alive = false
        }
    }
    expect(alive).toBe(false)
}, 30_000)
