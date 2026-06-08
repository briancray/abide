import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { belteImportName } from '../src/lib/shared/belteImportName.ts'

const roots: string[] = []
afterAll(() => {
    roots.forEach((root) => {
        rmSync(root, { recursive: true, force: true })
    })
})

// Writes a package.json into a fresh temp dir and returns the dir.
async function projectWith(packageJson: unknown): Promise<string> {
    const root = mkdtempSync(`${tmpdir()}/belte-import-name-`)
    roots.push(root)
    await Bun.write(`${root}/package.json`, JSON.stringify(packageJson))
    return root
}

test('uses the canonical name for a direct dependency', async () => {
    const cwd = await projectWith({ dependencies: { '@belte/belte': '^0.2.0' } })
    expect(await belteImportName(cwd)).toBe('@belte/belte')
})

test('uses the `belte` alias key for an npm alias', async () => {
    const cwd = await projectWith({ dependencies: { belte: 'npm:@belte/belte@^0.2.0' } })
    expect(await belteImportName(cwd)).toBe('belte')
})

test('uses the `belte` alias key for a workspace alias', async () => {
    const cwd = await projectWith({ dependencies: { belte: 'workspace:@belte/belte@*' } })
    expect(await belteImportName(cwd)).toBe('belte')
})

test('uses a non-`belte` alias key when that is how belte is declared', async () => {
    const cwd = await projectWith({ dependencies: { framework: 'npm:@belte/belte' } })
    expect(await belteImportName(cwd)).toBe('framework')
})

test('prefers the `belte` alias over a direct canonical dependency', async () => {
    const cwd = await projectWith({
        dependencies: { '@belte/belte': '^0.2.0', belte: 'npm:@belte/belte@^0.2.0' },
    })
    expect(await belteImportName(cwd)).toBe('belte')
})

test('finds the alias in devDependencies', async () => {
    const cwd = await projectWith({ devDependencies: { belte: 'npm:@belte/belte@^0.2.0' } })
    expect(await belteImportName(cwd)).toBe('belte')
})

test('falls back to the canonical name when belte is absent', async () => {
    const cwd = await projectWith({ dependencies: { svelte: '^5.0.0' } })
    expect(await belteImportName(cwd)).toBe('@belte/belte')
})

test('falls back to the canonical name when package.json is missing', async () => {
    const root = mkdtempSync(`${tmpdir()}/belte-import-name-`)
    roots.push(root)
    expect(await belteImportName(root)).toBe('@belte/belte')
})
