// SECTION 38 — THE COMMANDS BESIDE build, start AND dev, run as an author runs them: the CLI spawned,
// against a scaffolded tree or a served app.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const HANDLERS = `import { GET, jsonSchema, POST, reactive, refuse } from 'abide/server'

export const echo = GET((args: { id: string }) => ({ id: args.id }))

export const add = POST(({ a, b }: { a: number; b: number }) => a + b)

export const refused = POST(() => refuse(409, 'taken'))

export const faulted = GET((): string => {
    throw new Error('the database is on fire')
})

// A gate whose schema declares what the annotation leaves open.
export const kindOf = POST(
    reactive((args: { n: unknown }) => typeof args.n, {
        args: jsonSchema({ type: 'object', properties: { n: { type: 'number' } } }),
    }),
)
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp(
        {
            'ui/pages/page.abide': '<main>home</main>',
            'server/rpc/things.ts': HANDLERS,
        },
        { ...process.env, ABIDE_OPENAPI: '1', ABIDE_MCP: '1' },
    ))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 38.1 — THE LAYOUT, WRITTEN, and a step already done is skipped rather than overwritten. The
// scaffolded app then builds, which is what "a starter project" has to mean.
test('scaffold writes a starter project, skips what is there, and builds — 38.1, 38.43', async () => {
    const into = temporaryModule({ 'readme.md': 'here\n' })
    const first = await spawned(['bun', BIN, 'scaffold', 'ledger'], {
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

    // A dependency that installs: this checkout's own path, since no registry carries its version,
    // and the runtime's types beside it. THE REVERT: `^0.0.0` fails `bun install`, and without
    // `@types/bun` `abide check` reports `Bun` untyped in the starter's own `app.ts`.
    const manifest = await Bun.file(`${app}/package.json`).json()
    expect(manifest.dependencies.abide).toBe(
        `file:${new URL('..', import.meta.url).pathname.replace(/\/$/, '')}`,
    )
    expect(Object.keys(manifest.devDependencies)).toEqual(['@types/bun'])
    expect(
        (await Bun.file(`${app}/tsconfig.json`).json()).compilerOptions.types,
    ).toEqual(['bun'])

    const edited = 'edited by the author\n'
    await Bun.write(`${app}/src/ui/app.html`, edited)
    const again = await spawned(['bun', BIN, 'scaffold', 'ledger'], {
        cwd: into,
    })
    expect(again.exitCode).toBe(0)
    expect(again.stdout).toContain('kept    src/ui/app.html')
    expect(await Bun.file(`${app}/src/ui/app.html`).text()).toBe(edited)

    await Bun.write(
        `${app}/src/ui/app.html`,
        '<!doctype html><html><head></head><body></body></html>',
    )
    const built = await spawned(['bun', BIN, 'build'], { cwd: app })
    expect(built.stderr).toBe('')
    expect(built.exitCode).toBe(0)
})

// 38.44 — THE APP'S BUNDLER PLUGINS, where bun has an app declare them. A local plugin stands in for
// `bun-plugin-tailwind`, which is the same shape and a network install. THE REVERT: drop
// `appPlugins` from `bundleClient`; the stylesheet is built without the stamp.
test('build runs the plugins bunfig.toml declares over the client — 38.44', async () => {
    const app = temporaryModule({
        'package.json': JSON.stringify({
            name: 'stamped',
            type: 'module',
            imports: { '#ui/*': './src/ui/*' },
        }),
        'bunfig.toml': '[serve.static]\nplugins = ["./stamp.ts"]\n',
        'stamp.ts': `export default {
    name: 'stamp',
    setup(build: Bun.PluginBuilder) {
        build.onLoad({ filter: /\\.css$/ }, async ({ path }) => ({
            contents: (await Bun.file(path).text()) + '\\n.stamped-by-plugin { color: red }',
            loader: 'css',
        }))
    },
}
`,
        'src/ui/app.html':
            '<!doctype html><html><head></head><body></body></html>',
        'src/ui/app.css': 'main { color: blue }',
        'src/ui/pages/page.abide':
            "<script>\nimport '#ui/app.css'\n</script>\n<main>hi</main>",
    })
    const built = await spawned(['bun', BIN, 'build'], { cwd: app })
    expect(built.stderr).toBe('')
    const sheets = [...new Bun.Glob('*.css').scanSync(`${app}/.abide/client`)]
    expect(sheets.length).toBe(1)
    expect(
        await Bun.file(`${app}/.abide/client/${sheets[0]}`).text(),
    ).toContain('.stamped-by-plugin')
})

// 38.2 — EVERYTHING AFTER THE FILE IS THE SCRIPT'S, its own flags included, and the script runs in a
// scope of the runtime's. THE REVERT: parse the arguments before `run` takes them; `--verbose` is
// refused as an option the CLI does not know.
test('run passes everything after the file to the script — 38.2', async () => {
    const dir = temporaryModule({
        'script.ts': `import { request } from 'abide/server'
let scoped = 'no'
try { request() } catch (thrown) { scoped = (thrown as Error).message.includes('22.1') ? 'scope with no request' : 'other' }
console.log(JSON.stringify({ args: process.argv.slice(2), scoped }))
`,
    })
    const ran = await spawned(
        ['bun', BIN, 'run', 'script.ts', 'one', '--verbose', '-x'],
        { cwd: dir },
    )
    expect(ran.exitCode).toBe(0)
    expect(JSON.parse(ran.stdout.trim())).toEqual({
        args: ['one', '--verbose', '-x'],
        scoped: 'scope with no request',
    })
})

// 38.2 — THE SCRIPT ENDS WHEN IT ENDS, not when its top level settles: a timer it left pending
// still fires, and the `process.exitCode` it set is the process's. THE REVERT: return `0` from
// `run` after the import; the timer's line is never printed and this exits 0 where 3 is due.
test('run lets the script end on its own, keeping its exit code — 38.2', async () => {
    const dir = temporaryModule({
        'script.ts': `setTimeout(() => console.log('timer fired'), 50)
process.exitCode = 3
console.log('top level done')
`,
    })
    const ran = await spawned(['bun', BIN, 'run', 'script.ts'], { cwd: dir })
    expect(ran.stdout).toBe('top level done\ntimer fired\n')
    expect(ran.exitCode).toBe(3)
})

// 38.8 — ONE CALL, AND ITS EXIT CODE SAYS HOW IT WENT: 0 answered, 7 refused, 8 faulted.
test('call answers with the value, and exits 7 on a refusal and 8 on a fault — 38.8', async () => {
    const call = (...args: string[]) =>
        spawned(['bun', BIN, 'call', '--url', base, ...args])
    const echoed = await call('things/echo', '{"id":"4310"}', '--method', 'GET')
    expect(echoed.exitCode).toBe(0)
    expect(JSON.parse(echoed.stdout)).toEqual({ id: '4310' })
    const added = await call('things/add', '{"a":2,"b":3}')
    expect(added.exitCode).toBe(0)
    expect(added.stdout.trim()).toBe('5')
    const refused = await call('things/refused', '{}')
    expect(refused.exitCode).toBe(7)
    expect(refused.stderr).toContain('taken')
    expect((await call('things/faulted', '', '--method', 'GET')).exitCode).toBe(
        8,
    )
})

// 38.62 — A WORD IS COERCED BY THE APP IT REACHES, against the schema the app holds the call to: the
// handler's `args` gate where it declares one, not the annotation the build read. THE REVERT: coerce
// in the CLI against the build's annotation schema and send JSON; `n` stays text and the gate answers
// 422, "must be number, was string".
test('call coerces a word against the schema the app holds the call to — 38.62', async () => {
    const answered = await spawned([
        'bun',
        BIN,
        'call',
        '--url',
        base,
        'things/kindOf',
        'n=2',
    ])
    expect(answered.stderr).toBe('')
    expect(answered.stdout.trim()).toBe('"number"')
})

// 38.9 — the document from the running app, written rather than served.
test('openapi writes the document the app serves — 38.9', async () => {
    const out = `${temporaryModule({ 'keep.txt': '' })}/openapi.json`
    const written = await spawned([
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
