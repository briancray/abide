import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { writeRpcDts } from '../src/lib/shared/writeRpcDts.ts'

let dir: string | undefined

afterEach(() => {
    if (dir) {
        rmSync(dir, { recursive: true, force: true })
        dir = undefined
    }
})

/* Lays out a tmp project with the given rpc files, runs the codegen, returns the d.ts. */
async function generate(files: Record<string, string>): Promise<string> {
    dir = mkdtempSync(`${tmpdir()}/abide-rpcdts-`)
    const rpcDir = `${dir}/src/server/rpc`
    for (const [file, source] of Object.entries(files)) {
        await Bun.write(`${rpcDir}/${file}`, source)
    }
    await writeRpcDts({
        cwd: dir,
        rpcDir,
        rpcFiles: Object.keys(files),
        importName: '@abide/abide',
    })
    return Bun.file(`${dir}/src/.abide/rpc.d.ts`).text()
}

describe('writeRpcDts', () => {
    test('maps query-carrying rpcs to their args type, keyed by url', async () => {
        const dts = await generate({
            'search.ts': 'export const search = GET<{ q: string }>(handler)',
            'nested/thing.ts': 'export const thing = GET(handler)',
        })
        expect(dts).toContain("declare module '@abide/abide/shared/url'")
        expect(dts).toContain(
            '"/rpc/search": RpcArgs<typeof import("../server/rpc/search.ts").search>',
        )
        expect(dts).toContain(
            '"/rpc/nested/thing": RpcArgs<typeof import("../server/rpc/nested/thing.ts").thing>',
        )
    })

    test('omits body rpcs — a POST has no URL form', async () => {
        const dts = await generate({
            'read.ts': 'export const read = GET(handler)',
            'make.ts': 'export const make = POST(handler)',
        })
        expect(dts).toContain('"/rpc/read"')
        expect(dts).not.toContain('/rpc/make')
    })

    test('emits an inert empty interface when no rpcs qualify', async () => {
        const dts = await generate({ 'make.ts': 'export const make = POST(handler)' })
        expect(dts).toContain('interface RpcRoutes {')
        expect(dts).not.toContain('/rpc/')
    })
})
