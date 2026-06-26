/* Side-crossing guard: the client bundle must not import a server-only name.
   Exercises the real abideResolverPlugin against a temp fixture project. */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abideResolverPlugin } from '../src/abideResolverPlugin.ts'

let cwd: string
beforeAll(async () => {
    // realpath: macOS mkdtemp yields /var/... but Bun normalizes importers to /private/var/...
    cwd = realpathSync(await mkdtemp(join(tmpdir(), 'abide-sidecross-')))
    await mkdir(join(cwd, 'src/server/runtime'), { recursive: true })
    await mkdir(join(cwd, 'src/server/rpc'), { recursive: true })
    await mkdir(join(cwd, 'src/ui'), { recursive: true })
    // a server-only helper (NOT a proxied rpc/socket)
    await writeFile(join(cwd, 'src/server/secret.ts'), `export const secret = () => 42\n`)
    // a proxied rpc location
    await writeFile(join(cwd, 'src/server/rpc/getThing.ts'), `export const getThing = 1\n`)
    // a client helper that pulls the server-only helper — the violation, one hop deep
    await writeFile(
        join(cwd, 'src/ui/helper.ts'),
        `import { secret } from '../server/secret.ts'\nexport const render = () => secret()\n`,
    )
    // the page entry imports the helper → entry → helper → server/secret is a 3-node chain
    await writeFile(join(cwd, 'src/ui/page.ts'), `import { render } from './helper.ts'\nrender()\n`)
    // a page that imports a PROXIED rpc location relatively — must be allowed
    await writeFile(
        join(cwd, 'src/ui/proxied.ts'),
        `import { getThing } from '../server/rpc/getThing.ts'\nexport const x = getThing\n`,
    )
})
afterAll(async () => {
    await rm(cwd, { recursive: true, force: true })
})

async function build(entry: string, target: 'client' | 'server') {
    const result = await Bun.build({
        entrypoints: [join(cwd, entry)],
        target: 'browser',
        plugins: [abideResolverPlugin({ cwd, target })],
        throw: false,
    })
    const logs = result.logs.map((log) => String(log.message)).join('\n')
    return { success: result.success, logs }
}

test('client build rejects a server-only import with the full chain', async () => {
    const { success, logs } = await build('src/ui/page.ts', 'client')
    expect(success).toBe(false)
    expect(logs).toContain('server-only name')
    // evidence chain, in order: entry → helper → server/secret
    expect(logs).toContain('src/ui/page.ts')
    expect(logs).toContain('src/ui/helper.ts')
    expect(logs).toContain('src/server/secret.ts')
    expect(logs.indexOf('src/ui/page.ts')).toBeLessThan(logs.indexOf('src/ui/helper.ts'))
    expect(logs.indexOf('src/ui/helper.ts')).toBeLessThan(logs.indexOf('src/server/secret.ts'))
})

test('server build does NOT flag the same import', async () => {
    const { logs } = await build('src/ui/page.ts', 'server')
    expect(logs).not.toContain('server-only name')
})

test('client build allows a proxied rpc location (src/server/rpc/*)', async () => {
    // may fail for unrelated reasons (the stub imports abide/ui/remoteProxy, unresolvable in
    // the fixture), but it must NOT be flagged as a side-crossing.
    const { logs } = await build('src/ui/proxied.ts', 'client')
    expect(logs).not.toContain('server-only name')
})
