// SECTION 38 — THE COMMANDS BESIDE build, start AND dev, run as an author runs them: the CLI spawned,
// against a scaffolded tree or a served app.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const HANDLERS = `import { GET, POST, refuse } from 'abide/server'

export const echo = GET((args: { id: string }) => ({ id: args.id }))

export const add = POST(({ a, b }: { a: number; b: number }) => a + b)

export const refused = POST(() => refuse(409, 'taken'))

export const faulted = GET((): string => {
    throw new Error('the database is on fire')
})
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    process.env.ABIDE_OPENAPI = '1'
    process.env.ABIDE_MCP = '1'
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/rpc/things.ts': HANDLERS,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 38.1 — THE LAYOUT, WRITTEN, and a step already done is skipped rather than overwritten. The
// scaffolded app then builds, which is what "a starter project" has to mean.
test('scaffold writes a starter project, skips what is there, and builds — 38.1', () => {
    const into = temporaryModule({ 'readme.md': 'here\n' })
    const first = Bun.spawnSync(['bun', BIN, 'scaffold', 'ledger'], {
        cwd: into,
    })
    expect(first.exitCode).toBe(0)
    const app = `${into}/ledger`
    for (const path of [
        'src/ui/pages/page.abide',
        'src/ui/app.html',
        'src/server/app.ts',
        'package.json',
        'tsconfig.json',
        'biome.json',
    ])
        expect(`${path} ${Bun.file(`${app}/${path}`).size > 0}`).toBe(
            `${path} true`,
        )

    const edited = 'edited by the author\n'
    Bun.write(`${app}/src/ui/app.html`, edited)
    const again = Bun.spawnSync(['bun', BIN, 'scaffold', 'ledger'], {
        cwd: into,
    })
    expect(again.exitCode).toBe(0)
    expect(again.stdout.toString()).toContain('kept    src/ui/app.html')
    expect(
        require('node:fs').readFileSync(`${app}/src/ui/app.html`, 'utf8'),
    ).toBe(edited)

    Bun.write(
        `${app}/src/ui/app.html`,
        '<!doctype html><html><head></head><body></body></html>',
    )
    const built = Bun.spawnSync(['bun', BIN, 'build'], { cwd: app })
    expect(built.stderr.toString()).toBe('')
    expect(built.exitCode).toBe(0)
})

// 38.2 — EVERYTHING AFTER THE FILE IS THE SCRIPT'S, its own flags included, and the script runs in a
// scope of the runtime's. THE REVERT: parse the arguments before `run` takes them; `--verbose` is
// refused as an option the CLI does not know.
test('run passes everything after the file to the script — 38.2', () => {
    const dir = temporaryModule({
        'script.ts': `import { request } from 'abide/server'
let scoped = 'no'
try { request() } catch (thrown) { scoped = (thrown as Error).message.includes('22.1') ? 'scope with no request' : 'other' }
console.log(JSON.stringify({ args: process.argv.slice(2), scoped }))
`,
    })
    const ran = Bun.spawnSync(
        ['bun', BIN, 'run', 'script.ts', 'one', '--verbose', '-x'],
        { cwd: dir },
    )
    expect(ran.exitCode).toBe(0)
    expect(JSON.parse(ran.stdout.toString().trim())).toEqual({
        args: ['one', '--verbose', '-x'],
        scoped: 'scope with no request',
    })
})

// 38.2 — THE SCRIPT ENDS WHEN IT ENDS, not when its top level settles: a timer it left pending
// still fires, and the `process.exitCode` it set is the process's. THE REVERT: return `0` from
// `run` after the import; the timer's line is never printed and this exits 0 where 3 is due.
test('run lets the script end on its own, keeping its exit code — 38.2', () => {
    const dir = temporaryModule({
        'script.ts': `setTimeout(() => console.log('timer fired'), 50)
process.exitCode = 3
console.log('top level done')
`,
    })
    const ran = Bun.spawnSync(['bun', BIN, 'run', 'script.ts'], { cwd: dir })
    expect(ran.stdout.toString()).toBe('top level done\ntimer fired\n')
    expect(ran.exitCode).toBe(3)
})

// 38.8 — ONE CALL, AND ITS EXIT CODE SAYS HOW IT WENT: 0 answered, 7 refused, 8 faulted.
test('call answers with the value, and exits 7 on a refusal and 8 on a fault — 38.8', () => {
    const call = (...args: string[]) =>
        Bun.spawnSync(['bun', BIN, 'call', '--url', base, ...args])
    const echoed = call('things/echo', '{"id":"4310"}', '--method', 'GET')
    expect(echoed.exitCode).toBe(0)
    expect(JSON.parse(echoed.stdout.toString())).toEqual({ id: '4310' })
    const added = call('things/add', '{"a":2,"b":3}')
    expect(added.exitCode).toBe(0)
    expect(added.stdout.toString().trim()).toBe('5')
    const refused = call('things/refused', '{}')
    expect(refused.exitCode).toBe(7)
    expect(refused.stderr.toString()).toContain('taken')
    expect(call('things/faulted', '', '--method', 'GET').exitCode).toBe(8)
})

// 38.9 — the document from the running app, written rather than served.
test('openapi writes the document the app serves — 38.9', async () => {
    const out = `${temporaryModule({ 'keep.txt': '' })}/openapi.json`
    const written = Bun.spawnSync([
        'bun',
        BIN,
        'openapi',
        '--url',
        base,
        '--out',
        out,
    ])
    expect(written.exitCode).toBe(0)
    const document = (await Bun.file(out).json()) as {
        paths: Record<string, unknown>
    }
    expect(Object.keys(document.paths)).toContain('/__abide/rpc/things/echo')
})

// 38.9, 38.14 — THE MCP BRIDGE OVER STDIO: a line in is a message, a line out is its answer.
test('mcp bridges stdio to the app — 38.14', async () => {
    const bridge = Bun.spawn(['bun', BIN, 'mcp', '--url', base], {
        stdin: 'pipe',
        stdout: 'pipe',
    })
    bridge.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`,
    )
    bridge.stdin.flush()
    const reader = (bridge.stdout as ReadableStream<Uint8Array>).getReader()
    let seen = ''
    while (!seen.includes('\n'))
        seen += new TextDecoder().decode((await reader.read()).value)
    bridge.kill()
    const answer = JSON.parse(seen.trim()) as {
        result: { tools: { name: string }[] }
    }
    expect(answer.result.tools.map((tool) => tool.name)).toContain('things_add')
})
