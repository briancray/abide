// SECTION 38 — THE COMMANDS BESIDE build, start AND dev, run as an author runs them: the CLI spawned,
// against a scaffolded tree or a served app.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { handlerFiles, serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const HANDLERS = `import { GET, jsonSchema, POST, reactive, refuse } from '@abide/abide/server'

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
    ;({ base, stop } = await serveApp({
        'index.abide': '<main>home</main>',
        ...handlerFiles('things', HANDLERS),
    }))
}, 30_000)

// THE APP `--root` NAMES, UNDER `src/`, so the build it gets with no `--out` lands beside that `src/`
// in this fixture's own directory (38.25). `serveApp`'s fixture sits directly under `.test-modules/`, where every
// test file's fixture would build into the one `.test-modules/.abide` under `--parallel`.
function rootedApp(): string {
    const files: Record<string, string> = {
        'package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
        'src/index.abide': '<main>home</main>',
    }
    for (const [name, text] of Object.entries(handlerFiles('things', HANDLERS)))
        files[`src/${name}`] = text
    return `${temporaryModule(files)}/src`
}

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 38.1 — THE LAYOUT, WRITTEN, and a step already done is skipped rather than overwritten. The
// scaffolded app then builds, which is what "a starter project" has to mean.
test('scaffold writes a starter project, skips what is there, and builds — 38.1, 38.42, 38.103, 38.104', async () => {
    const into = temporaryModule({ 'readme.md': 'here\n' })
    const first = await spawned(['bun', BIN, 'scaffold', 'ledger'], {
        cwd: into,
    })
    expect(first.exitCode).toBe(0)
    const app = `${into}/ledger`
    for (const path of [
        'src/index.abide',
        'src/layout.abide',
        'package.json',
        'tsconfig.json',
        'biome.json',
        'AGENTS.md',
        'CLAUDE.md',
        // Written rather than copied: a packer drops both from the tarball.
        'bunfig.toml',
        '.gitignore',
    ])
        expect(`${path} ${Bun.file(`${app}/${path}`).size > 0}`).toBe(
            `${path} true`,
        )

    // A dependency that installs: this checkout's own path, since no registry carries its version,
    // and the runtime's types beside it. THE REVERT: `^0.0.0` fails `bun install`, and without
    // `@types/bun` `abide check` reports `Bun` untyped in the starter's own root layout.
    const manifest = await Bun.file(`${app}/package.json`).json()
    expect(manifest.dependencies['@abide/abide']).toBe(
        `file:${new URL('..', import.meta.url).pathname.replace(/\/$/, '')}`,
    )
    expect(Object.keys(manifest.devDependencies)).toEqual(['@types/bun'])
    // 38.103, 38.104 — the checker `tsc` cannot stand in for, and an agent pointed at the docs the
    // package installs with. THE REVERT: drop `check` from the scripts, or the paths from AGENTS.md.
    expect(manifest.scripts.check).toBe('abide check')
    const agents = await Bun.file(`${app}/AGENTS.md`).text()
    for (const shipped of ['abide.md', 'REGISTRY.md', 'RULEBOOK.md'])
        expect(agents).toContain(`node_modules/@abide/abide/docs/${shipped}`)
    expect(await Bun.file(`${app}/CLAUDE.md`).text()).toBe('@AGENTS.md\n')
    expect(
        (await Bun.file(`${app}/tsconfig.json`).json()).compilerOptions.types,
    ).toEqual(['bun'])

    const scaffolded = await Bun.file(`${app}/src/index.abide`).text()
    const edited = 'edited by the author\n'
    await Bun.write(`${app}/src/index.abide`, edited)
    const again = await spawned(['bun', BIN, 'scaffold', 'ledger'], {
        cwd: into,
    })
    expect(again.exitCode).toBe(0)
    expect(again.stdout).toContain('kept    src/index.abide')
    expect(await Bun.file(`${app}/src/index.abide`).text()).toBe(edited)

    await Bun.write(`${app}/src/index.abide`, scaffolded)
    const built = await spawned(['bun', BIN, 'build'], { cwd: app })
    expect(built.stderr).toBe('')
    expect(built.exitCode).toBe(0)
})

// 38.105, 38.106 — WHAT AN INSTALL CARRIES BESIDE THE CODE: the docs the scaffold's AGENTS.md
// names, written by `prepack` into a directory `files` ships. THE REVERT: drop `docs` from `files`,
// or the `prepack` that writes it, and the paths AGENTS.md names are absent from every install.
test('the published package carries the docs and the rulebook — 38.105, 38.106', async () => {
    const manifest = await Bun.file(
        new URL('../package.json', import.meta.url),
    ).json()
    expect(manifest.files).toContain('docs')
    expect(manifest.scripts.prepack).toBe('bun ../../scripts/packDocs.ts')
    const packDocs = await Bun.file(
        new URL('../../../scripts/packDocs.ts', import.meta.url),
    ).text()
    for (const shipped of ['abide.md', 'RULEBOOK.md', 'REGISTRY.md'])
        expect(packDocs).toContain(shipped)
})

// 38.43 — THE APP'S BUNDLER PLUGINS, where bun has an app declare them. A local plugin stands in for
// `bun-plugin-tailwind`, which is the same shape and a network install. THE REVERT: drop
// `appPlugins` from `clientBundle`; the stylesheet is built without the stamp.
test('build runs the plugins bunfig.toml declares over the client — 38.43', async () => {
    const app = temporaryModule({
        'package.json': JSON.stringify({
            name: 'stamped',
            type: 'module',
            imports: { '#src/*': './src/*' },
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
        'src/lib/app.css': 'main { color: blue }',
        'src/index.abide':
            "<script>\nimport '#src/lib/app.css'\n</script>\n<main>hi</main>",
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
        'script.ts': `import { request } from '@abide/abide/server'
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

// 38.61 — A WORD IS COERCED BY THE APP IT REACHES, against the schema the app holds the call to: the
// handler's `args` gate where it declares one, not the annotation the build read. THE REVERT: coerce
// in the CLI against the build's annotation schema and send JSON; `n` stays text and the gate answers
// 422, "must be number, was string".
test('call coerces a word against the schema the app holds the call to — 38.61', async () => {
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

// 38.7, 38.8 — A CALL AIMED AT `--url` BUILDS NOTHING HERE, run from inside an app that would refuse to
// build. THE REVERT: read the handler table through `serveBuild`'s build; the local refusal (34.3)
// aborts the call with exit 1 before the remote app sees a request, and no build is left beside it.
test('a call to --url builds nothing where it is run — 38.7, 38.8', async () => {
    const here = temporaryModule({
        'package.json': '{"name":"elsewhere"}',
        'src/index.abide': '<script>await Promise.resolve()</script><p>x</p>',
    })
    const answered = await spawned(
        ['bun', BIN, 'call', '--url', base, 'things/add', 'a=2', 'b=3'],
        { cwd: here },
    )
    expect(answered.stderr).toBe('')
    expect(answered.stdout).toBe('5\n')
    expect(await Bun.file(`${here}/.abide/compilation.json`).exists()).toBe(
        false,
    )
})

// 38.9, 38.111 — the document from the running app, printed rather than served.
test('openapi prints the document the app serves — 38.9, 38.111', async () => {
    const printed = await spawned(['bun', BIN, 'openapi', '--url', base])
    expect(printed.exitCode).toBe(0)
    const document = JSON.parse(printed.stdout) as {
        paths: Record<string, unknown>
    }
    expect(Object.keys(document.paths)).toContain('/things/echo')
})

// 38.25 — `--root` IS THE APP FOR EVERY PART OF A COMMAND, run from inside another package. THE
// REVERT: announce the package found under the working directory rather than the one `--root`
// found; the banner names `elsewhere`, the package the shell stood in.
test('start --root announces the app it serves, wherever it is run — 38.25, 38.6', async () => {
    const here = temporaryModule({ 'package.json': '{"name":"elsewhere"}' })
    const server = Bun.spawn(
        ['bun', BIN, 'start', '--root', rootedApp(), '--port', '0'],
        { cwd: here, stdout: 'pipe', stderr: 'pipe' },
    )
    let printed = ''
    try {
        for await (const chunk of server.stdout) {
            printed += new TextDecoder().decode(chunk)
            if (printed.includes('http://')) break
        }
    } finally {
        server.kill('SIGKILL')
    }
    expect(printed).toContain('fixture')
    expect(printed).not.toContain('elsewhere')
})

// 38.9, 38.25 — WITH NO `--url`, THE APP `--root` NAMES is booted here, not the one the shell
// stands in. THE REVERT: boot what `createApp` finds under the working directory; there is none,
// and the command exits 1 with "createApp found no app". 38.110, 38.111 — the app is unbuilt, so
// it is built first. THE REVERT: say the build's summary on stdout; the document no longer parses.
test('openapi --root boots the app it names and prints its document — 38.9, 38.25, 38.110, 38.111', async () => {
    const here = temporaryModule({ 'package.json': '{"name":"elsewhere"}' })
    const printed = await spawned(
        ['bun', BIN, 'openapi', '--root', rootedApp()],
        { cwd: here },
    )
    expect(printed.exitCode).toBe(0)
    const document = JSON.parse(printed.stdout) as {
        paths: Record<string, unknown>
    }
    expect(Object.keys(document.paths)).toContain('/things/echo')
})

// 38.9, 38.13 — THE MCP BRIDGE OVER STDIO: a line in is a message, a line out is its answer.
test('mcp bridges stdio to the app — 38.13', async () => {
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
    expect(answer.result.tools.map((tool) => tool.name)).toContain(
        'post_things_add',
    )
})
