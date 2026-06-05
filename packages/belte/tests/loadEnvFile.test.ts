import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnvFile } from '../src/lib/shared/loadEnvFile.ts'

const dirs: string[] = []
const keys = ['BELTE_TEST_A', 'BELTE_TEST_B', 'BELTE_TEST_QUOTED']
afterEach(() => {
    dirs.forEach((dir) => {
        rmSync(dir, { recursive: true, force: true })
    })
    dirs.length = 0
    keys.forEach((key) => {
        delete process.env[key]
    })
})

// Writes a `.env` into a fresh temp dir and returns its path.
async function envFileWith(content: string): Promise<string> {
    const dir = mkdtempSync(`${tmpdir()}/belte-env-`)
    dirs.push(dir)
    const path = join(dir, '.env')
    await Bun.write(path, content)
    return path
}

test('merges declared vars into process.env and strips quotes', async () => {
    const path = await envFileWith('BELTE_TEST_A=plain\nBELTE_TEST_QUOTED="quoted"\n')
    await loadEnvFile(path)
    expect(process.env.BELTE_TEST_A).toBe('plain')
    expect(process.env.BELTE_TEST_QUOTED).toBe('quoted')
})

test('does not override a value already set (fill-when-unset)', async () => {
    process.env.BELTE_TEST_A = 'ambient'
    const path = await envFileWith('BELTE_TEST_A=fromfile\nBELTE_TEST_B=fromfile\n')
    await loadEnvFile(path)
    expect(process.env.BELTE_TEST_A).toBe('ambient')
    expect(process.env.BELTE_TEST_B).toBe('fromfile')
})

test('ignores comments and is a no-op for a missing file', async () => {
    const path = await envFileWith('# a comment\nBELTE_TEST_A=value\n')
    await loadEnvFile(path)
    expect(process.env.BELTE_TEST_A).toBe('value')
    await loadEnvFile(join(tmpdir(), 'belte-env-does-not-exist', '.env'))
    expect(process.env.BELTE_TEST_A).toBe('value')
})
