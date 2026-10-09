// SECTION 45 — `assistant` over a served app, with each provider abide ships: `claudeApi` against a
// scripted Messages API, and `claudeCode` through a real `abide-bridge` paired with the app, running a
// scripted Claude Code (`fixtures/assistant`). Both play the same conversation: a turn that calls
// `invoices_whoami`, and a turn that says what it answered.

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { BRIDGE_PATH } from '../../bridge/src/bridge.ts'
import { BRIDGE_VERSION } from '../src/server/BRIDGE_VERSION.ts'
import { BRIDGE_ADDRESS } from '../src/shared/ADDRESSES.ts'
import { lastLinePrinted, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const FIXTURES = new URL('./fixtures/assistant/', import.meta.url).pathname
const FAKE_CLAUDE = `${FIXTURES}fakeClaudeCode.ts`
const BRIDGE = new URL('../../bridge/', import.meta.url).pathname
const RECORD = `${Bun.env.TMPDIR ?? '/tmp'}/abide-assistant-${process.pid}.json`
const SERVER = new URL('../src/server', import.meta.url).pathname

const INVOICES = `import { cookies, POST } from 'abide/server'

export const whoami = POST(() => cookies().get('who') ?? 'nobody', { description: 'Who is asking.' })
`

const ASK = `import { assistant, type AssistantMessage, claudeApi, claudeCode, GET, POST } from 'abide/server'

const HIDDEN = { clients: { mcp: false } }

export const bridge = GET(() => claudeCode.bridge(), { ...HIDDEN, timeout: Infinity })

export const command = GET(() => claudeCode.bridgeCommand(), HIDDEN)

export const ask = POST(
    async function* ({ messages, via, maxTurns }: { messages: AssistantMessage[]; via: 'api' | 'code'; maxTurns?: number }) {
        yield* assistant(
            messages,
            via === 'api'
                ? claudeApi({ apiKey: 'key', baseURL: process.env.FAKE_API, model: 'claude-opus-5', max_tokens: 1000 })
                : claudeCode({ model: 'sonnet', appendSystemPrompt: 'Be brief.' }),
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
        ABIDE_MCP: '1',
        ABIDE_BRIDGE: '1',
    }
    ;({ app, base, stop } = await serveApp(
        {
            'ui/pages/page.abide': '<main>home</main>',
            'server/rpc/invoices.ts': INVOICES,
            'server/rpc/ask.ts': ASK,
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
    const answer = await Bun.fetch(`${base}/__abide/rpc/ask/command`, {
        headers: asPage(caller),
    })
    const { command } = (await answer.json()) as { command: string }
    return command.split(' ').at(-1) as string
}

/** A bridge paired with `caller`, once it has said it connected. */
async function pairBridge(
    caller: string,
    code?: string,
): Promise<Bun.Subprocess> {
    const running = Bun.spawn(
        [
            'bun',
            `${BRIDGE}bin/abideBridge.ts`,
            base,
            code ?? (await pairingCode(caller)),
            '--claude',
            FAKE_CLAUDE,
        ],
        { stderr: 'pipe', env: environment },
    )
    bridges.push(running)
    let said = ''
    for await (const chunk of running.stderr as ReadableStream<Uint8Array>) {
        said += new TextDecoder().decode(chunk)
        if (said.includes('\n')) break
    }
    if (!said.startsWith('Connected'))
        throw new Error(`the bridge did not connect: ${said}`)
    return running
}

function ask(
    caller: string,
    via: 'api' | 'code',
    content: string,
    maxTurns?: number,
): Promise<Response> {
    return Bun.fetch(`${base}/__abide/rpc/ask/ask`, {
        method: 'POST',
        headers: {
            ...asPage(caller),
            'content-type': 'application/json',
            accept: 'application/jsonl',
        },
        body: JSON.stringify({
            via,
            maxTurns,
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

// 45.2, 45.7, 45.17 — ONE CONVERSATION, ONE EVENT SEQUENCE, WHICHEVER PROVIDER PLAYED IT, and the tool
// called as the person asking: `whoami` reads the cookie on the ASK request, which for Claude Code is a
// request the bridge never sees. THE REVERTS: carry no headers (`CARRIED_HEADERS = []`), and both read
// `"nobody"`; send the API turn's blocks back without the thinking block's signature, and the fake API
// refuses the second turn 400; answer the bridge's `tools/call` with no result, and Claude Code's
// sequence loses its `"ada"`.
test('both providers play one conversation as one event sequence, tools called as the asker — 45.2, 45.7, 45.17', async () => {
    const expected = [
        { type: 'text', text: 'checking' },
        { type: 'tool', id: 'toolu_1', name: 'invoices_whoami', input: {} },
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

// 45.11 — THE LAST TURN'S TOOL CALL IS NEVER RUN. With one turn allowed, the model's call to
// `invoices_whoami` is announced as it streams, but no `result` follows and the conversation ends on
// `max_turns` rather than the `tool_use` the turn stopped for. THE REVERTS: yield `stop` as it arrived
// in `claudeApi`'s `done`, and this reads `tool_use`; drop `turn >= maxTurns`, and the call runs and a
// second turn answers `saw "ada"`.
test('a conversation out of turns ends on max_turns without running the pending call — 45.11', async () => {
    expect(await events(await ask('one', 'api', 'who am I?', 1))).toEqual([
        { type: 'text', text: 'checking' },
        { type: 'tool', id: 'toolu_1', name: 'invoices_whoami', input: {} },
        { type: 'done', stop: 'max_turns', usage: { input: 1, output: 2 } },
    ])
})

// 45.20 — THE PAGE SEES THE PAIRING LAND. The status stream says not ready, with the command, and then
// ready once a bridge connects with that command's code. THE REVERT: drop `wakeWatchers` from `pair`;
// the stream never says ready and this times out.
test('the bridge status turns ready the moment the bridge connects — 45.20', async () => {
    const answer = await Bun.fetch(`${base}/__abide/rpc/ask/bridge`, {
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
        `bunx abide-bridge@${BRIDGE_VERSION} ${base} `,
    )
    await pairBridge('two', first.command.split(' ').at(-1))
    expect((await lines.next()).value).toEqual({ paired: true })
    await lines.return(undefined)
}, 30_000)

// 45.13, 45.14 — a page with no bridge paired is told so, and a code pairs once.
test('nothing paired refuses 409, and a pairing code pairs only once — 45.13, 45.14', async () => {
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

// 45.5, 45.15, 45.16 — CLAUDE CODE RUNS ALONE on the visitor's machine: its own tools off, no settings read,
// only the bridge's MCP server, in a directory of its own that is gone once the run is, and with only
// what the site may set; the transcript reaches it as ONE message. THE REVERTS: send the last turn
// alone, and the prompt holds no `earlier answer`; drop the `rm`, and the config outlives the run.
test('Claude Code runs alone, over the whole transcript as one message — 45.5, 45.15, 45.16', async () => {
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

// 45.18 — A CALLER WHO HANGS UP ENDS THE RUN on the visitor's machine: the page's answer cancelled once
// the first event is in. THE REVERT: drop the `cancel` frame `claudeCode` sends on abort; the fake
// waits forever and its pid still answers a signal 0.
test('a caller hanging up kills the Claude Code run — 45.18', async () => {
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

// 45.3 — a transcript ending on the model's own turn is refused before any provider is reached.
test('a transcript that does not end on a user turn is refused — 45.3', async () => {
    const answer = await Bun.fetch(`${base}/__abide/rpc/ask/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            via: 'api',
            messages: [{ role: 'assistant', content: 'hello' }],
        }),
    })
    expect(answer.status).toBe(400)
    expect(await answer.text()).toContain('45.3')
}, 30_000)

// 45.6, 42.12 — A TOOL IS CALLED THROUGH THE APP ANSWERING THE CONVERSATION, not whichever `App` the
// process built last: two held in one process, the second stopped, and the first still lists and
// calls its tools. THE REVERT: build the `McpSurface` in `bootApp` over `RPC_SERVER.raw` rather than
// the app's own `fetch`, and set that to `fetch` alone; the stopped app answers the tool call, and its
// result reads "the app is stopping".
test('a tool is called through the app answering the conversation — 45.6, 42.12', async () => {
    await Bun.write(
        `${app}/host.ts`,
        `import { bootApp, originUnder } from '${SERVER}/createApp.ts'
import { loadBuild } from '${SERVER}/serveBuild.ts'

const boot = () => bootApp(originUnder('${app}'), () => loadBuild({ root: '${app}', out: '${app}/.abide' }))
const first = await boot()
const second = await boot()
await second.stop()
const answer = await first.fetch(new Request('http://app.test/__abide/rpc/ask/ask', {
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
