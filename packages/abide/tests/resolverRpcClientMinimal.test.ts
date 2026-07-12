/* ADR-0022 addendum: the client rpc transform emits a MINIMAL module — the `remoteProxy` export
   plus only the top-level statements the live `opts` reaches — instead of keeping the whole file and
   trusting DCE. This closes the class the keep-the-file bet leaked: a server module reachable from
   module-level handler-support code (the common `const db = getDb()` drizzle shape) is LOADED before
   tree-shaking, which is fatal for a Bun builtin like `bun:sqlite` on a browser target and surfaces
   as a raw bundler error before abide's own guard runs. These tests drive the real
   abideResolverPlugin client build through the rpc onLoad path. */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { abideResolverPlugin } from '../src/abideResolverPlugin.ts'

// The abide package root, linked into the fixture's node_modules so `@abide/abide/ui/remoteProxy`
// (the client banner import) and `@abide/abide/server/GET` resolve during the build.
const ABIDE_PKG = resolve(import.meta.dir, '..')

let cwd: string
beforeAll(async () => {
    cwd = realpathSync(await mkdtemp(join(tmpdir(), 'abide-rpc-minimal-')))
    await mkdir(join(cwd, 'src/server/rpc'), { recursive: true })
    await mkdir(join(cwd, 'src/server/lib'), { recursive: true })
    await mkdir(join(cwd, 'src/shared'), { recursive: true })
    await mkdir(join(cwd, 'src/ui'), { recursive: true })
    mkdirSync(join(cwd, 'node_modules/@abide'), { recursive: true })
    symlinkSync(ABIDE_PKG, join(cwd, 'node_modules/@abide/abide'))
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'x' }))

    // A server-only module that imports a Bun builtin — loading it on a browser target is fatal.
    await writeFile(
        join(cwd, 'src/server/lib/getDb.ts'),
        `import { Database } from 'bun:sqlite'\nconst handle = new Database(':memory:')\nexport const getDb = () => handle\n`,
    )
    // A client-safe shared schema the endpoint policy references.
    await writeFile(join(cwd, 'src/shared/schema.ts'), `export const schema = { input: 1 }\n`)

    // The reported failure: the rpc file touches the server db at MODULE scope (the drizzle
    // `const db = getDb()` shape). The handler-elision keeps that statement, so keep-the-file loads
    // getDb → bun:sqlite → fatal. The minimal emit drops it (opts never reaches it).
    await writeFile(
        join(cwd, 'src/server/rpc/getSimilarFiles.ts'),
        `import { GET } from '@abide/abide/server/GET'\n` +
            `import { getDb } from '$server/lib/getDb'\n` +
            `import { schema } from '$shared/schema'\n` +
            `const db = getDb()\n` +
            `export const getSimilarFiles = GET((args) => db.query('x'), { schemas: { input: schema } })\n`,
    )
    await writeFile(
        join(cwd, 'src/ui/entry.ts'),
        `import { getSimilarFiles } from '$server/rpc/getSimilarFiles'\nconsole.log(getSimilarFiles)\n`,
    )
})
afterAll(async () => {
    await rm(cwd, { recursive: true, force: true })
})

async function buildClient(entry: string) {
    const result = await Bun.build({
        entrypoints: [join(cwd, entry)],
        target: 'browser',
        metafile: true,
        throw: false,
        plugins: [abideResolverPlugin({ cwd, target: 'client' })],
    })
    const logs = result.logs.map((log) => String(log.message)).join('\n')
    const inputs = Object.keys(result.metafile?.inputs ?? {})
    const output = result.outputs[0] ? await result.outputs[0].text() : ''
    return { success: result.success, logs, inputs, output }
}

test('a module-level server reference (bun:sqlite) no longer fatals the client build', async () => {
    const { success, logs, inputs } = await buildClient('src/ui/entry.ts')
    expect(success).toBe(true)
    // The Bun builtin is never loaded — no raw "cannot import Bun builtin" bundler error.
    expect(logs).not.toContain('bun:sqlite')
    expect(inputs.some((path) => path.includes('getDb'))).toBe(false)
    expect(inputs.some((path) => path.toLowerCase().includes('sqlite'))).toBe(false)
})

test('the emitted client module ships only the remoteProxy fetch and its opts', async () => {
    const { output } = await buildClient('src/ui/entry.ts')
    // The endpoint policy (schemas.input) survives; the server handler body does not.
    expect(output).toContain('/rpc/getSimilarFiles')
    expect(output).not.toContain('getDb')
})
