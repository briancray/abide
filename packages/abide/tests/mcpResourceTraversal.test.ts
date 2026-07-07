import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMcpResourceServer } from '../src/lib/mcp/createMcpResourceServer.ts'

const PREFIX = 'abide://resources/'
let dir: string
let server: ReturnType<typeof createMcpResourceServer>

describe('createMcpResourceServer — path traversal', () => {
    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), 'abide-mcp-res-'))
        await writeFile(join(dir, 'ok.txt'), 'hello')
        server = createMcpResourceServer({ resourcesDir: dir })
    })
    afterAll(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    test('reads a legit in-dir resource', async () => {
        const res = await server.read(`${PREFIX}ok.txt`)
        expect(res).toBeDefined()
    })

    test('rejects forward-slash `..` traversal', async () => {
        expect(await server.read(`${PREFIX}../../../etc/passwd`)).toBeUndefined()
    })

    test('rejects backslash `..` traversal (the Windows escape)', async () => {
        expect(await server.read(`${PREFIX}..\\..\\..\\Windows\\win.ini`)).toBeUndefined()
    })

    test('rejects an absolute path outside the dir', async () => {
        expect(await server.read(`${PREFIX}/etc/passwd`)).toBeUndefined()
    })
})
