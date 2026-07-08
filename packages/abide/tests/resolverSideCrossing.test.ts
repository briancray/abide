/* Side-crossing guard (ADR-0022 D3): reachability-based, judged post-DCE from the client
   build's metafile. A server-only module that SURVIVES tree-shaking into the client bundle is a
   violation (flagged with its import chain); one reached only through dead code (the elided rpc
   handler's imports) is dropped and allowed. Exercises the real abideResolverPlugin against a
   temp fixture project. */
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
    await mkdir(join(cwd, 'src/server/rpc'), { recursive: true })
    await mkdir(join(cwd, 'src/shared'), { recursive: true })
    await mkdir(join(cwd, 'src/ui'), { recursive: true })

    // a server-only helper (NOT a proxied rpc/socket) and server-only state
    await writeFile(join(cwd, 'src/server/secret.ts'), `export const secret = () => 42\n`)
    await writeFile(join(cwd, 'src/server/db.ts'), `export const dbState = { ttl: 5 }\n`)
    // a proxied rpc location
    await writeFile(join(cwd, 'src/server/rpc/getThing.ts'), `export const getThing = 1\n`)
    // a client-safe (shared) policy module a cache policy may import
    await writeFile(join(cwd, 'src/shared/policy.ts'), `export const policy = { ttl: 5 }\n`)

    // LIVE crossing: a client helper that actually calls the server-only helper.
    await writeFile(
        join(cwd, 'src/ui/helper.ts'),
        `import { secret } from '../server/secret.ts'\nexport const render = () => secret()\n`,
    )
    await writeFile(join(cwd, 'src/ui/page.ts'), `import { render } from './helper.ts'\nrender()\n`)

    // a page that imports a PROXIED rpc location relatively — must be allowed
    await writeFile(
        join(cwd, 'src/ui/proxied.ts'),
        `import { getThing } from '../server/rpc/getThing.ts'\nexport const x = getThing\n`,
    )

    // DEAD server import: models the D2 client rpc transform — the handler's server import stays
    // textually but is never referenced (handler elided), while the endpoint policy imports a
    // client-safe shared module. secret must tree-shake out; policy survives.
    await writeFile(
        join(cwd, 'src/ui/rpcLikeClean.ts'),
        `import { secret } from '../server/secret.ts'\nimport { policy } from '../shared/policy.ts'\nexport const proxy = { cache: policy }\n`,
    )
    await writeFile(
        join(cwd, 'src/ui/cleanEntry.ts'),
        `import { proxy } from './rpcLikeClean.ts'\nconsole.log(proxy)\n`,
    )

    // LIVE policy crossing: the endpoint policy itself references server-only state — a real
    // reachability violation the ADR replaces the old "inline it" constraint with.
    await writeFile(
        join(cwd, 'src/ui/rpcLikeDirty.ts'),
        `import { dbState } from '../server/db.ts'\nexport const proxy = { cache: { ttl: dbState.ttl } }\n`,
    )
    await writeFile(
        join(cwd, 'src/ui/dirtyEntry.ts'),
        `import { proxy } from './rpcLikeDirty.ts'\nconsole.log(proxy)\n`,
    )
})
afterAll(async () => {
    await rm(cwd, { recursive: true, force: true })
})

async function build(entry: string, target: 'client' | 'server') {
    // metafile: true feeds the onEnd reachability guard; an onEnd throw rejects the build promise.
    try {
        const result = await Bun.build({
            entrypoints: [join(cwd, entry)],
            target: 'browser',
            metafile: true,
            plugins: [abideResolverPlugin({ cwd, target })],
            throw: false,
        })
        const logs = result.logs.map((log) => String(log.message)).join('\n')
        return { success: result.success, logs }
    } catch (error) {
        return { success: false, logs: (error as Error).message }
    }
}

test('client build flags a LIVE-reached server-only import with the full chain', async () => {
    const { success, logs } = await build('src/ui/page.ts', 'client')
    expect(success).toBe(false)
    expect(logs).toContain('server-only name')
    // evidence chain, in order: entry → helper → server/secret (scoped past the header, where the
    // offender path also appears, so the ordering is asserted on the chain rendering itself)
    const chain = logs.slice(logs.indexOf('Import chain:'))
    expect(chain).toContain('src/ui/page.ts')
    expect(chain).toContain('src/ui/helper.ts')
    expect(chain).toContain('src/server/secret.ts')
    expect(chain.indexOf('src/ui/page.ts')).toBeLessThan(chain.indexOf('src/ui/helper.ts'))
    expect(chain.indexOf('src/ui/helper.ts')).toBeLessThan(chain.indexOf('src/server/secret.ts'))
})

test('server build does NOT flag the same import', async () => {
    const { logs } = await build('src/ui/page.ts', 'server')
    expect(logs).not.toContain('server-only name')
})

test('client build allows a proxied rpc location (src/server/rpc/*)', async () => {
    const { logs } = await build('src/ui/proxied.ts', 'client')
    expect(logs).not.toContain('server-only name')
})

test('a DEAD server import (elided handler) tree-shakes out and is allowed', async () => {
    // The server helper is imported but never referenced (handler elided); the policy imports a
    // client-safe module. DCE drops the server helper, so the reachability guard sees no violation.
    const { success, logs } = await build('src/ui/cleanEntry.ts', 'client')
    expect(logs).not.toContain('server-only name')
    expect(success).toBe(true)
})

test('a policy that LIVE-references server-only state is flagged with a chain', async () => {
    const { success, logs } = await build('src/ui/dirtyEntry.ts', 'client')
    expect(success).toBe(false)
    expect(logs).toContain('server-only name')
    // chain: entry → rpcLikeDirty → server/db
    const chain = logs.slice(logs.indexOf('Import chain:'))
    expect(chain).toContain('src/ui/dirtyEntry.ts')
    expect(chain).toContain('src/ui/rpcLikeDirty.ts')
    expect(chain).toContain('src/server/db.ts')
    expect(chain.indexOf('src/ui/dirtyEntry.ts')).toBeLessThan(
        chain.indexOf('src/ui/rpcLikeDirty.ts'),
    )
    expect(chain.indexOf('src/ui/rpcLikeDirty.ts')).toBeLessThan(chain.indexOf('src/server/db.ts'))
})
