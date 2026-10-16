// SECTION 45 — `assistant` over a served app, with each provider abide ships: `claudeApi` against a
// scripted Messages API, and `claudeCode` through a real `abide-bridge` paired with the app, running a
// scripted Claude Code (`fixtures/assistant`). Both play the same conversation: a turn that calls
// `post_invoices_whoami`, and a turn that says what it answered.

import { afterAll, afterEach, beforeAll, expect, jest, test } from 'bun:test'
import { spawned } from '@abide/harness/gate'
import {
    HEARTBEAT_MILLISECONDS as BRIDGE_HEARTBEAT_MILLISECONDS,
    BRIDGE_PATH,
    RESUME_MILLISECONDS as BRIDGE_RESUME_MILLISECONDS,
} from '../../bridge/src/bridge.ts'
import { readLines } from '../../bridge/src/readLines.ts'
import { BRIDGE_VERSION } from '../src/server/BRIDGE_VERSION.ts'
import type { ClaudeCodeConfig } from '../src/server/claudeCode.ts'
import {
    answerBridge,
    HEARTBEAT_MILLISECONDS,
    mintCode,
    RESUME_MILLISECONDS,
} from '../src/server/bridgeRelay.ts'
import { BRIDGE_ADDRESS } from '../src/shared/ADDRESSES.ts'
import { handlerFiles, lastLinePrinted, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const FIXTURES = new URL('./fixtures/assistant/', import.meta.url).pathname
const FAKE_CLAUDE = `${FIXTURES}fakeClaudeCode.ts`
const BRIDGE = new URL('../../bridge/', import.meta.url).pathname
const RECORD = `${Bun.env.TMPDIR ?? '/tmp'}/abide-assistant-${process.pid}.json`
const SERVER = new URL('../src/server', import.meta.url).pathname

const INVOICES = `import { cookies, POST } from '@abide/abide/server'

export default POST(() => cookies().get('who') ?? 'nobody', { description: 'Who is asking.' })
`

const ASK = `import { assistant, type AssistantMessage, claudeApi, claudeCode, type ClaudeCodeConfig, GET, POST } from '@abide/abide/server'

const HIDDEN = { clients: { mcp: false } }

export const bridge = GET(() => claudeCode.bridge(), { ...HIDDEN, timeout: Infinity })

export const command = GET(() => claudeCode.bridgeCommand(), HIDDEN)

export const ask = POST(
    async function* ({ messages, via, maxTurns, config }: { messages: AssistantMessage[]; via: 'api' | 'code'; maxTurns?: number; config?: Record<string, unknown> }) {
        yield* assistant(
            messages,
            via === 'api'
                ? claudeApi({ apiKey: 'key', baseURL: process.env.FAKE_API, model: 'claude-opus-5', max_tokens: 1000 })
                // Loose, so an option no site may set reaches the bridge to be refused there.
                : claudeCode((config ?? { model: 'sonnet', appendSystemPrompt: 'Be brief.' }) as ClaudeCodeConfig),
            { mcp: true, maxTurns },
        )
    },
    HIDDEN,
)
`

let app = ''
let base = ''
let stop = (): void => {}
let api: Bun.Subprocess | undefined
const bridges: Bun.Subprocess[] = []
// What every child here runs under — the app, the bridges, a host — set in this file alone: a flag
// left on `process.env` reaches every app the worker serves after this file.
let environment: Record<string, string | undefined> = process.env

beforeAll(async () => {
    api = Bun.spawn(['bun', `${FIXTURES}fakeMessagesApi.ts`], {
        stdout: 'pipe',
    })
    let printed = ''
    for await (const chunk of api.stdout as ReadableStream<Uint8Array>) {
        printed += new TextDecoder().decode(chunk)
        if (printed.includes('\n')) break
    }
    environment = {
        ...process.env,
        FAKE_API: printed.trim().replace(/\/$/, ''),
        FAKE_RECORD: RECORD,
    }
    ;({ app, base, stop } = await serveApp(
        {
            'index.abide': '<main>home</main>',
            'invoices/whoami.ts': INVOICES,
            // 16.2 — three handler files at the root, each re-exporting the module's binding.
            ...handlerFiles('', ASK),
        },
        environment,
    ))
}, 30_000)

afterEach(() => {
    for (const running of bridges.splice(0)) running.kill()
})

afterAll(async () => {
    stop()
    api?.kill()
    removeTemporaryModules()
    await Bun.file(RECORD)
        .delete()
        .catch(() => {})
})

/** The headers a page in the browser `caller` sends, signed in as `ada`. */
function asPage(caller: string): Record<string, string> {
    return { cookie: `who=ada; abide-caller=${caller}` }
}

async function pairingCode(caller: string): Promise<string> {
    const answer = await Bun.fetch(`${base}/command`, {
        headers: asPage(caller),
    })
    const { command } = (await answer.json()) as { command: string }
    return command.split(' ').at(-1) as string
}

/**
 * A bridge paired with `caller`, run with `claudeArgs` after its `--`, once it has said it connected —
 * with what it says after that.
 */
async function pairBridge(
    caller: string,
    code?: string,
    claudeArgs: string[] = [],
): Promise<{ running: Bun.Subprocess; saysNext: () => Promise<string> }> {
    const running = Bun.spawn(
        [
            'bun',
            `${BRIDGE}bin/abideBridge.ts`,
            base,
            code ?? (await pairingCode(caller)),
            '--claude',
            FAKE_CLAUDE,
            ...(claudeArgs.length === 0 ? [] : ['--', ...claudeArgs]),
        ],
        { stderr: 'pipe', env: environment },
    )
    bridges.push(running)
    const reader = (running.stderr as ReadableStream<Uint8Array>).getReader()
    const saysNext = async (): Promise<string> => {
        const { value } = await reader.read()
        return new TextDecoder().decode(value)
    }
    const said = await saysNext()
    if (!said.startsWith('Connected'))
        throw new Error(`the bridge did not connect: ${said}`)
    return { running, saysNext }
}

function ask(
    caller: string,
    via: 'api' | 'code',
    content: string,
    maxTurns?: number,
    config?: ClaudeCodeConfig,
): Promise<Response> {
    return Bun.fetch(`${base}/ask`, {
        method: 'POST',
        headers: {
            ...asPage(caller),
            'content-type': 'application/json',
            accept: 'application/jsonl',
        },
        body: JSON.stringify({
            via,
            maxTurns,
            config,
            messages: [
                { role: 'user', content: 'earlier question' },
                { role: 'assistant', content: 'earlier answer' },
                { role: 'user', content },
            ],
        }),
    })
}

async function events(answer: Response): Promise<unknown[]> {
    const text = await answer.text()
    if (answer.status !== 200) throw new Error(`${answer.status}: ${text}`)
    const found: unknown[] = []
    for (const line of text.split('\n'))
        if (line !== '') found.push(JSON.parse(line))
    return found
}

// 44.19, 36.7 — THE RELAY OPENS WITH THE FIRST PAIRING COMMAND, so it runs first: every test after it
// mints one. THE REVERT: drop the `minted` check from `answerBridge`, and the first ask is the 403
// a stale code gets rather than 404.
test('the relay answers 404 until the app mints a pairing code — 44.19, 36.7', async () => {
    const before = await Bun.fetch(`${base}/__abide/bridge?code=none`)
    expect(before.status).toBe(404)
    await before.text()
    await pairingCode('relay')
    const after = await Bun.fetch(`${base}/__abide/bridge?code=none`)
    expect(after.status).toBe(403)
    await after.text()
})

// 44.2, 44.7, 44.17 — ONE CONVERSATION, ONE EVENT SEQUENCE, WHICHEVER PROVIDER PLAYED IT, and the tool
// called as the person asking: `whoami` reads the cookie on the ASK request, which for Claude Code is a
// request the bridge never sees. THE REVERTS: carry no headers (`CARRIED_HEADERS = []`), and both read
// `"nobody"`; send the API turn's blocks back without the thinking block's signature, and the fake API
// refuses the second turn 400; answer the bridge's `tools/call` with no result, and Claude Code's
// sequence loses its `"ada"`.
test('both providers play one conversation as one event sequence, tools called as the asker — 44.2, 44.7, 44.17', async () => {
    const expected = [
        { type: 'text', text: 'checking' },
        { type: 'tool', id: 'toolu_1', name: 'post_invoices_whoami' },
        { type: 'input', id: 'toolu_1', input: {} },
        { type: 'result', id: 'toolu_1', text: '"ada"', failed: false },
        { type: 'text', text: 'saw "ada"' },
        { type: 'done', stop: 'end_turn', usage: { input: 3, output: 5 } },
    ]
    expect(await events(await ask('one', 'api', 'who am I?'))).toEqual(expected)
    await pairBridge('one')
    expect(await events(await ask('one', 'code', 'who am I?'))).toEqual(
        expected,
    )
}, 30_000)

// 44.11 — THE LAST TURN'S TOOL CALL IS NEVER RUN. With one turn allowed, the model's call to
// `post_invoices_whoami` is announced as it streams, but no `result` follows and the conversation ends on
// `max_turns` rather than the `tool_use` the turn stopped for. THE REVERTS: yield `stop` as it arrived
// in `claudeApi`'s `done`, and this reads `tool_use`; drop `turn >= maxTurns`, and the call runs and a
// second turn answers `saw "ada"`.
test('a conversation out of turns ends on max_turns without running the pending call — 44.11', async () => {
    expect(await events(await ask('one', 'api', 'who am I?', 1))).toEqual([
        { type: 'text', text: 'checking' },
        { type: 'tool', id: 'toolu_1', name: 'post_invoices_whoami' },
        { type: 'input', id: 'toolu_1', input: {} },
        { type: 'done', stop: 'max_turns', usage: { input: 1, output: 2 } },
    ])
})

/** The events `answer` yields until one is a `tool`, or until two seconds pass with none. */
async function eventsUntilTool(answer: Response): Promise<unknown[]> {
    const lines = readLines(answer.body as ReadableStream<Uint8Array>)
    const deadline = Bun.sleep(2_000).then(() => undefined)
    const found: { type: string }[] = []
    while (found.at(-1)?.type !== 'tool') {
        const read = await Promise.race([lines.next(), deadline])
        if (read === undefined || read.done) break
        if (read.value !== '') found.push(JSON.parse(read.value))
    }
    await lines.return(undefined)
    return found
}

// 44.29 — A CALL IS ANNOUNCED AS THE MODEL STARTS WRITING IT. Both models start `post_invoices_whoami`
// and never finish writing it, so the `tool` is all a page can have seen, and no `input` follows. THE
// REVERTS: yield `tool` at `content_block_stop` in `claudeApi`, or report it from the finished
// `assistant` line in the bridge, and that provider yields nothing for two seconds.
test('a tool call is announced before its input is written — 44.29', async () => {
    const started = [
        { type: 'tool', id: 'toolu_1', name: 'post_invoices_whoami' },
    ]
    expect(await eventsUntilTool(await ask('one', 'api', 'writing'))).toEqual(
        started,
    )
    await pairBridge('one')
    expect(await eventsUntilTool(await ask('one', 'code', 'writing'))).toEqual([
        { type: 'text', text: 'checking' },
        ...started,
    ])
}, 30_000)

// 44.20 — THE PAGE SEES THE PAIRING LAND. The status stream says not ready, with the command, and then
// ready once a bridge connects with that command's code. THE REVERT: drop `wakeWatchers` from `pair`;
// the stream never says ready and this times out.
test('the bridge status turns ready the moment the bridge connects — 44.20', async () => {
    const answer = await Bun.fetch(`${base}/bridge`, {
        headers: { ...asPage('two'), accept: 'application/jsonl' },
    })
    const lines = (async function* () {
        let buffered = ''
        for await (const chunk of answer.body as ReadableStream<Uint8Array>) {
            buffered += new TextDecoder().decode(chunk)
            let newline = buffered.indexOf('\n')
            while (newline !== -1) {
                yield JSON.parse(buffered.slice(0, newline)) as {
                    paired: boolean
                    command?: string
                }
                buffered = buffered.slice(newline + 1)
                newline = buffered.indexOf('\n')
            }
        }
    })()
    const first = (await lines.next()).value as {
        paired: boolean
        command: string
    }
    expect(first.paired).toBe(false)
    expect(first.command).toStartWith(
        `bunx @abide/bridge@${BRIDGE_VERSION} ${base} `,
    )
    await pairBridge('two', first.command.split(' ').at(-1))
    expect((await lines.next()).value).toEqual({ paired: true })
    await lines.return(undefined)
}, 30_000)

// 44.13, 44.14 — a page with no bridge paired is told so, and a code pairs once.
test('nothing paired refuses 409, and a pairing code pairs only once — 44.13, 44.14', async () => {
    const unpaired = await ask('three', 'code', 'who am I?')
    expect(unpaired.status).toBe(409)
    await unpaired.text()
    const code = await pairingCode('three')
    await pairBridge('three', code)
    const again = await spawned(
        [
            'bun',
            `${BRIDGE}bin/abideBridge.ts`,
            base,
            code,
            '--claude',
            FAKE_CLAUDE,
        ],
        { deadline: 10_000, env: environment },
    )
    expect(again.exitCode).toBe(1)
    expect(again.stderr).toContain('403')
}, 30_000)

// 44.5, 44.15, 44.16 — CLAUDE CODE RUNS ALONE on the visitor's machine where they gave it nothing: its own
// tools off, no settings read, only the bridge's MCP server, in a directory of its own that is gone once
// the run is, and with what the site may set; the transcript reaches it as ONE message. THE REVERTS: send the last turn
// alone, and the prompt holds no `earlier answer`; drop the `rm`, and the config outlives the run.
test('Claude Code runs alone, over the whole transcript as one message — 44.5, 44.15, 44.16', async () => {
    await pairBridge('four')
    await events(await ask('four', 'code', 'who am I?'))
    const record = (await Bun.file(RECORD).json()) as {
        args: string[]
        prompt: string
        configPath: string
        config: { mcpServers: { app: { url: string } } }
    }
    expect(record.prompt).toBe(
        '<conversation>\n<user>\nearlier question\n</user>\n<assistant>\nearlier answer\n</assistant>\n</conversation>\n\nwho am I?',
    )
    const after = (flag: string): string | undefined =>
        record.args[record.args.indexOf(flag) + 1]
    expect(after('--tools')).toBe('')
    expect(after('--setting-sources')).toBe('')
    expect(record.args).toContain('--strict-mcp-config')
    expect(after('--model')).toBe('sonnet')
    expect(after('--append-system-prompt')).toBe('Be brief.')
    expect(record.config.mcpServers.app.url).toStartWith('http://127.0.0.1:')
    expect(await Bun.file(record.configPath).exists()).toBe(false)
}, 30_000)

// 44.15, 44.30 — THE SITE ASKS, THE VISITOR GRANTS: a built-in tool is the turn's only where both named
// it, approved as granted, and the bridge says once what it was asked for and not given; an option the
// visitor set outranks the site's. THE REVERTS: lay the site's `tools` on unfiltered, and `--tools`
// reads `WebSearch,WebFetch`; lay the visitor's options before the site's, and the last `--model` is
// `sonnet`.
test('a built-in tool runs only where the site asked and the visitor granted — 44.15, 44.30', async () => {
    const { saysNext } = await pairBridge('six', undefined, [
        '--tools',
        'WebSearch',
        '--model',
        'opus',
    ])
    const config = { model: 'sonnet', tools: ['WebSearch', 'WebFetch'] }
    await events(await ask('six', 'code', 'who am I?', undefined, config))
    const { args } = (await Bun.file(RECORD).json()) as { args: string[] }
    expect(args[args.indexOf('--tools') + 1]).toBe('WebSearch')
    const allowed = args.indexOf('--allowedTools')
    expect(args.slice(allowed + 1, allowed + 3)).toEqual([
        'mcp__app',
        'WebSearch',
    ])
    expect(args[args.lastIndexOf('--model') + 1]).toBe('opus')
    expect(await saysNext()).toContain('asked for WebFetch')
    await events(await ask('six', 'code', 'who am I?', undefined, config))
    const second = saysNext()
    expect(
        await Promise.race([second, Bun.sleep(200).then(() => 'nothing')]),
    ).toBe('nothing')
}, 30_000)

// 44.16 — AN OPTION THAT REACHES THE VISITOR'S MACHINE IS NOT THE SITE'S TO SET: the turn fails naming
// it, before Claude Code runs. THE REVERT: lay every option on as its flag, and the fake runs with
// `--add-dir /`.
test('a site setting an option it may not fails the turn — 44.16', async () => {
    await pairBridge('seven')
    await Bun.file(RECORD)
        .delete()
        .catch(() => {})
    const answer = await ask('seven', 'code', 'who am I?', undefined, {
        addDir: ['/'],
    } as ClaudeCodeConfig)
    expect(await answer.text()).toContain('takes no `addDir` from a site')
    expect(await Bun.file(RECORD).exists()).toBe(false)
}, 30_000)

// 44.18 — A CALLER WHO HANGS UP ENDS THE RUN on the visitor's machine: the page's answer canceled once
// the first event is in. THE REVERT: drop the `cancel` frame `claudeCode` sends on abort; the fake
// waits forever and its pid still answers a signal 0.
test('a caller hanging up kills the Claude Code run — 44.18', async () => {
    await pairBridge('five')
    const answer = await ask('five', 'code', 'hang')
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()
    const { pid } = (await Bun.file(RECORD).json()) as { pid: number }
    await reader.cancel()
    let alive = true
    for (let tries = 0; alive && tries < 50; tries++) {
        await Bun.sleep(50)
        try {
            process.kill(pid, 0)
        } catch {
            alive = false
        }
    }
    expect(alive).toBe(false)
}, 30_000)

// 44.3 — a transcript ending on the model's own turn is refused before any provider is reached.
test('a transcript that does not end on a user turn is refused — 44.3', async () => {
    const answer = await Bun.fetch(`${base}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            via: 'api',
            messages: [{ role: 'assistant', content: 'hello' }],
        }),
    })
    expect(answer.status).toBe(400)
    expect(await answer.text()).toContain('44.3')
}, 30_000)

// 44.6, 42.12 — A TOOL IS CALLED THROUGH THE APP ANSWERING THE CONVERSATION, not whichever `App` the
// process built last: two held in one process, the second stopped, and the first still lists and
// calls its tools. THE REVERT: build the `McpSurface` in `bootApp` over `RPC_SERVER.raw` rather than
// the app's own `fetch`, and set that to `fetch` alone; the stopped app answers the tool call, and its
// result reads "the app is stopping".
test('a tool is called through the app answering the conversation — 44.6, 42.12', async () => {
    await Bun.write(
        `${app}/host.ts`,
        `import { bootApp, originUnder } from '${SERVER}/createApp.ts'
import { loadBuild, serveBuild } from '${SERVER}/serveBuild.ts'

await serveBuild('${app}', '${app}/.abide')
const boot = () => bootApp(originUnder('${app}'), () => loadBuild({ root: '${app}', out: '${app}/.abide' }))
const first = await boot()
const second = await boot()
await second.stop()
const answer = await first.fetch(new Request('http://app.test/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/jsonl', cookie: 'who=ada' },
    body: JSON.stringify({ via: 'api', messages: [{ role: 'user', content: 'who am I?' }] }),
}))
console.log(JSON.stringify({ status: answer.status, text: await answer.text() }))
`,
    )
    const printed = await lastLinePrinted<{ status: number; text: string }>(
        ['bun', `${app}/host.ts`],
        { cwd: app, env: environment },
    )
    expect(printed.status).toBe(200)
    expect(printed.text).toContain('"text":"saw \\"ada\\""')
}, 30_000)

// The command a site shows names the bridge release that speaks this relay.
test('the pairing command names the bridge package’s own version', async () => {
    const own = (await Bun.file(`${BRIDGE}package.json`).json()) as {
        version: string
    }
    expect(BRIDGE_VERSION).toBe(own.version)
})

// The bridge spells the relay's address out rather than importing it, so this is what holds the two
// sides to one address — apart, the bridge dials a path nothing answers.
test('the bridge dials the address the site relays at', () => {
    expect(BRIDGE_PATH).toBe(BRIDGE_ADDRESS)
})

/** What a bridge run to its end against a `fakeBridgeSite` misbehaving as `how` said, and the site saw. */
async function againstFakeSite(
    how: 'drop' | 'mute' | 'refuse' | 'silent',
    replyMilliseconds: number,
    silenceMilliseconds?: number,
): Promise<{ exitCode: number; stderr: string; saw: string[] }> {
    const site = Bun.spawn(['bun', `${FIXTURES}fakeBridgeSite.ts`, how], {
        stdout: 'pipe',
        env: environment,
    })
    const reader = (site.stdout as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let printed = ''
    while (!printed.includes('\n')) {
        const { done, value } = await reader.read()
        if (done) break
        printed += decoder.decode(value, { stream: true })
    }
    const origin = printed.slice(0, printed.indexOf('\n')).replace(/\/$/, '')
    try {
        const ran = await spawned(
            [
                'bun',
                `${FIXTURES}bridgeHost.ts`,
                origin,
                'code',
                FAKE_CLAUDE,
                String(replyMilliseconds),
                ...(silenceMilliseconds === undefined
                    ? []
                    : [String(silenceMilliseconds)]),
            ],
            { deadline: 15_000, env: environment },
        )
        site.kill()
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            printed += decoder.decode(value, { stream: true })
        }
        return {
            exitCode: ran.exitCode,
            stderr: ran.stderr,
            saw: printed.split('\n').slice(1),
        }
    } finally {
        site.kill()
    }
}

/** The MCP server's reply to the record-mode fake's tool call. */
async function recordedReply(): Promise<unknown> {
    return ((await Bun.file(RECORD).json()) as { reply: unknown }).reply
}

// 44.24 — A REPORT THE SITE REFUSED IS A FAILED TOOL CALL, not one Claude Code waits on for good: the
// site answers every post 500, and the call the post carried is answered failed with what the site
// said. THE REVERT: swallow the post's failure (`.catch(() => {})`, no `answer`); the call waits out
// the 60-second reply deadline, and the bridge outlives the 15-second wait here.
test('a report the site refused answers its tool call failed — 44.24', async () => {
    const { exitCode } = await againstFakeSite('refuse', 60_000)
    expect(exitCode).toBe(0)
    expect(await recordedReply()).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
            content: [
                {
                    type: 'text',
                    text: expect.stringContaining('refused a report (500)'),
                },
            ],
            isError: true,
        },
    })
}, 30_000)

// 44.24 — A REPLY THAT NEVER COMES IS A FAILED TOOL CALL once the deadline passes. THE REVERT: drop
// the `deadline` timer; the call waits for good, and the bridge outlives the wait here.
test('a tool call the site never replies to fails at the deadline — 44.24', async () => {
    const { exitCode } = await againstFakeSite('silent', 300)
    expect(exitCode).toBe(0)
    expect(await recordedReply()).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
            content: [
                {
                    type: 'text',
                    text: expect.stringContaining('no reply within 300 ms'),
                },
            ],
            isError: true,
        },
    })
}, 30_000)

// 44.25 — A DROPPED STREAM IS REDIALED with the pairing's token. THE REVERT: end where the stream ends
// (`redial` answering `undefined`); the site never sees the redial.
test('a bridge redials a dropped stream with its token — 44.25', async () => {
    const { exitCode, stderr, saw } = await againstFakeSite('drop', 60_000)
    expect(exitCode).toBe(0)
    expect(saw).toContain('resumed Bearer token-1')
    expect(stderr).toContain('Reconnected')
}, 30_000)

// 44.28 — A STREAM THAT GOES SILENT WITHOUT ENDING IS REDIALED once the silence passes the bound: the
// site says `paired` and then nothing, holding the connection open. THE REVERT: drop the `silence`
// timer; the bridge reads the open stream for good and outlives the 15-second wait here.
test('a bridge redials a stream gone silent — 44.28', async () => {
    const { exitCode, stderr, saw } = await againstFakeSite('mute', 60_000, 500)
    expect(exitCode).toBe(0)
    expect(saw).toContain('resumed Bearer token-1')
    expect(stderr).toContain('Reconnected')
}, 30_000)

// 44.27 — A PAIRING'S STREAM CARRIES A COMMENT EVERY HEARTBEAT while it has nothing to send. THE
// REVERT: answer `framed`'s body bare in `attach`; the read past the heartbeat waits for good.
test('a pairing stream beats while it is quiet — 44.27', async () => {
    jest.useFakeTimers()
    try {
        const { code } = mintCode('heartbeat')
        const answer = (await answerBridge(
            new Request(`http://site${BRIDGE_ADDRESS}?code=${code}`),
        )) as Response
        const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
        const decoder = new TextDecoder()
        let read = ''
        while (!read.includes('"paired"'))
            read += decoder.decode((await reader.read()).value)
        jest.advanceTimersByTime(HEARTBEAT_MILLISECONDS)
        const beat = await Promise.race([
            reader.read().then((next) => decoder.decode(next.value)),
            new Promise<string>((done) => setImmediate(() => done('nothing'))),
        ])
        expect(beat).toBe(':\n\n')
        await reader.cancel()
    } finally {
        jest.useRealTimers()
    }
})

/** The `data:` frames an event stream carries, parsed, as they land. */
async function* framesOf(
    answer: Response,
): AsyncGenerator<{ type: string; token?: string }> {
    let buffered = ''
    for await (const chunk of answer.body as ReadableStream<Uint8Array>) {
        buffered += new TextDecoder().decode(chunk)
        let newline = buffered.indexOf('\n')
        while (newline !== -1) {
            const line = buffered.slice(0, newline)
            buffered = buffered.slice(newline + 1)
            if (line.startsWith('data: '))
                yield JSON.parse(line.slice('data: '.length))
            newline = buffered.indexOf('\n')
        }
    }
}

// 44.26 — A PAIRING OUTLIVES ITS DROPPED STREAM, and the turn asked meanwhile is sent once the stream
// is resumed by its token. THE REVERT: drop the bridge on the stream's abort, as `pair` did; the ask
// is refused 409 and the resume 401.
test('a dropped pairing is held, and resumed by its token with what it missed — 44.26', async () => {
    const pairing = framesOf(
        await Bun.fetch(
            `${base}${BRIDGE_ADDRESS}?code=${await pairingCode('six')}`,
        ),
    )
    const first = (await pairing.next()).value
    expect(first?.type).toBe('paired')
    // The stream dropped: its body canceled, which closes the connection.
    await pairing.return(undefined)
    await Bun.sleep(200)
    // Answered once the turn says something, which is only once a bridge has it.
    const asked = Bun.fetch(`${base}/ask`, {
        method: 'POST',
        headers: {
            ...asPage('six'),
            'content-type': 'application/json',
            accept: 'application/jsonl',
        },
        body: JSON.stringify({
            via: 'code',
            messages: [{ role: 'user', content: 'hang' }],
        }),
    })
    const resumed = await Bun.fetch(`${base}${BRIDGE_ADDRESS}`, {
        headers: { authorization: `Bearer ${first?.token}` },
    })
    expect(resumed.status).toBe(200)
    const frames = framesOf(resumed)
    const turn = (await frames.next()).value as { type: string; id: string }
    expect(turn.type).toBe('turn')
    // The turn ended as a bridge would end it, so the ask answers.
    await Bun.fetch(`${base}${BRIDGE_ADDRESS}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${first?.token}` },
        body: JSON.stringify({ type: 'fail', turn: turn.id, message: 'done' }),
    })
    await (await asked).text()
    await frames.return(undefined)
}, 30_000)

// The bridge spells the site's resume window out rather than importing it, so this holds the two to
// one length — apart, a bridge gives up on a pairing the site still holds, or dials one it dropped.
test('the bridge redials for as long as the site holds a pairing', () => {
    expect(BRIDGE_RESUME_MILLISECONDS).toBe(RESUME_MILLISECONDS)
})

// Spelled out for the same reason: apart, a bridge takes a quiet stream for a dropped one, or waits
// on a dead one longer than the bound says.
test('the bridge bounds silence by the heartbeat the site sends', () => {
    expect(BRIDGE_HEARTBEAT_MILLISECONDS).toBe(HEARTBEAT_MILLISECONDS)
})
