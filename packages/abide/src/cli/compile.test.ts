// `abide compile` produces a STANDALONE executable (BP1.6-1.7) — the whole point is that it answers
// requests with no source tree, no node_modules and no `dist/` beside it, so the test compiles a real
// project, runs the binary from a DIFFERENT directory, and asserts over HTTP.
//
// The fixture is a temp project with a symlinked `node_modules/abide`, because that is exactly how a
// real app resolves the framework — the generated entry imports `abide/...` as a package specifier so
// the binary carries ONE copy of abide, shared with the app's own modules.
//
// One compile covers page SSR through a layout + a component, an in-template RPC read, the embedded
// client chunks, and an embedded `src/ui/public` file: each is a different runtime lookup that compile
// had to turn into a build-time one.
//
// The SERVER face is the `serve` subcommand; the command face of the same binary is
// `compileAsCommand.test.ts`. They are one artifact, which is asserted here directly: the binary this
// test hosts also answers a subcommand.

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from './compile.ts'

const ABIDE_PACKAGE_DIR = join(import.meta.dir, '../..')

const tempDirs: string[] = []

function tempPath(prefix: string): string {
    const dir = join(tmpdir(), `abide-${prefix}-${Bun.randomUUIDv7()}`)
    tempDirs.push(dir)
    return dir
}

afterAll(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

async function fixtureProject(): Promise<string> {
    const dir = tempPath('compile-app')
    await Bun.write(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'compiled', type: 'module', dependencies: { abide: '*' } }),
    )
    await Bun.write(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                paths: { '$server/*': ['./src/server/*'], '$ui/*': ['./src/ui/*'] },
            },
        }),
    )
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await symlink(ABIDE_PACKAGE_DIR, join(dir, 'node_modules/abide'))

    await Bun.write(
        join(dir, 'src/server/rpc/greet.ts'),
        `import { GET } from 'abide/server/GET'\n` +
            `export default GET(({ name = 'world' }) => \`Hello, \${name}!\`)\n`,
    )
    await Bun.write(join(dir, 'src/ui/pages/layout.abide'), `<main>{children()}</main>`)
    await Bun.write(join(dir, 'src/ui/components/Badge.abide'), `<b class="badge">compiled</b>`)
    await Bun.write(
        join(dir, 'src/ui/pages/page.abide'),
        `<script>\n` +
            `  import greet from '$server/rpc/greet'\n` +
            `  import Badge from '$ui/components/Badge.abide'\n` +
            `</script>\n` +
            `<h1>{await greet({ name: 'binary' })}</h1>\n` +
            `<Badge/>\n`,
    )
    await Bun.write(join(dir, 'src/ui/public/robots.txt'), 'User-agent: *\n')
    return dir
}

// Boot the executable from a directory that holds NOTHING but the executable, so anything it still
// reads off the filesystem fails loudly instead of silently finding the project it was built from.
// The binary prints its bound URL, which is also how the test learns the ephemeral port it chose.
async function runBinary(
    executable: string,
): Promise<{ url: string; stop: () => Promise<void>; output: () => string }> {
    const emptyCwd = tempPath('compile-run')
    await mkdir(emptyCwd, { recursive: true })
    const proc = Bun.spawn([executable, 'serve', '--port', '0'], {
        cwd: emptyCwd,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    let text = ''
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    const deadline = Date.now() + 20_000
    let url: string | undefined
    while (url === undefined && Date.now() < deadline) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        url = /http:\/\/localhost:\d+/.exec(text)?.[0]
    }
    if (url === undefined) {
        proc.kill()
        throw new Error(`compiled binary never reported a URL. Output:\n${text}`)
    }
    return {
        url,
        output: () => text,
        stop: async () => {
            proc.kill()
            await proc.exited
        },
    }
}

describe('abide compile — standalone executable', () => {
    test('serves SSR pages, RPCs, client chunks and public files with no project on disk', async () => {
        const dir = await fixtureProject()
        const runDir = tempPath('compile-out')
        await mkdir(runDir, { recursive: true })
        const executable = join(runDir, 'app')

        expect(await compile(dir, { out: executable })).toEqual([executable])
        expect(await Bun.file(executable).exists()).toBe(true)

        // The source the binary was built from is GONE — a lingering read of it must fail the test,
        // not quietly succeed because the build machine still had the files.
        await rm(dir, { recursive: true, force: true })

        const server = await runBinary(executable)
        try {
            const page = await fetch(server.url)
            expect(page.status).toBe(200)
            const html = await page.text()
            // The page's RPC read resolved in-proc during SSR (value inline), the layout wrapped it,
            // and the imported component rendered — three separate build-time emissions.
            expect(html).toContain('Hello, binary!')
            expect(html).toContain('<main>')
            expect(html).toContain('class="badge"')

            // The client entry is served from the EMBEDDED build, at the same content-addressed URL the
            // document points at.
            const entry = /\/__abide\/chunk\/loader-[a-z0-9]+\.js/.exec(html)?.[0]
            expect(entry).toBeDefined()
            const chunk = await fetch(`${server.url}${entry}`)
            expect(chunk.status).toBe(200)
            expect(chunk.headers.get('cache-control')).toContain('immutable')

            const rpc = await fetch(`${server.url}/__abide/rpc/greet?name=abide`)
            expect(rpc.status).toBe(200)
            expect(await rpc.json()).toBe('Hello, abide!')

            const robots = await fetch(`${server.url}/robots.txt`)
            expect(robots.status).toBe(200)
            expect(await robots.text()).toContain('User-agent')

            // The baked schema map travelled too: OpenAPI is generated from it, with no tsgo in the binary.
            const openapi = await fetch(`${server.url}/openapi.json`)
            expect(openapi.status).toBe(200)
            const document = (await openapi.json()) as { paths: Record<string, unknown> }
            expect(document.paths['/__abide/rpc/greet']).toBeDefined()
        } finally {
            await server.stop()
        }

        // ONE artifact: the executable this test just hosted also dispatches rpcs as subcommands.
        // There is no server-only build to produce.
        const asCommand = Bun.spawn([executable, 'greet', '--name', 'command'], {
            cwd: runDir,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const printed = await new Response(asCommand.stdout).text()
        expect(await asCommand.exited).toBe(0)
        expect(printed.trim()).toBe('"Hello, command!"')
    }, 120_000)
})
