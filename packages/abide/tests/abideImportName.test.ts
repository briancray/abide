import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { abideImportName } from '../src/lib/shared/abideImportName.ts'

const roots: string[] = []
afterAll(() => {
    roots.forEach((root) => {
        rmSync(root, { recursive: true, force: true })
    })
})

// Writes a package.json into a fresh temp dir and returns the dir.
async function projectWith(packageJson: unknown): Promise<string> {
    const root = mkdtempSync(`${tmpdir()}/abide-import-name-`)
    roots.push(root)
    await Bun.write(`${root}/package.json`, JSON.stringify(packageJson))
    return root
}

test('uses the canonical name for a direct dependency', async () => {
    const cwd = await projectWith({ dependencies: { '@abide/abide': '^0.2.0' } })
    expect(await abideImportName(cwd)).toBe('@abide/abide')
})

test('uses the `abide` alias key for an npm alias', async () => {
    const cwd = await projectWith({ dependencies: { abide: 'npm:@abide/abide@^0.2.0' } })
    expect(await abideImportName(cwd)).toBe('abide')
})

test('uses the `abide` alias key for a workspace alias', async () => {
    const cwd = await projectWith({ dependencies: { abide: 'workspace:@abide/abide@*' } })
    expect(await abideImportName(cwd)).toBe('abide')
})

test('uses a non-`abide` alias key when that is how abide is declared', async () => {
    const cwd = await projectWith({ dependencies: { framework: 'npm:@abide/abide' } })
    expect(await abideImportName(cwd)).toBe('framework')
})

test('prefers the `abide` alias over a direct canonical dependency', async () => {
    const cwd = await projectWith({
        dependencies: { '@abide/abide': '^0.2.0', abide: 'npm:@abide/abide@^0.2.0' },
    })
    expect(await abideImportName(cwd)).toBe('abide')
})

test('finds the alias in devDependencies', async () => {
    const cwd = await projectWith({ devDependencies: { abide: 'npm:@abide/abide@^0.2.0' } })
    expect(await abideImportName(cwd)).toBe('abide')
})

test('falls back to the canonical name when abide is absent', async () => {
    const cwd = await projectWith({ dependencies: { zod: '^3.0.0' } })
    expect(await abideImportName(cwd)).toBe('@abide/abide')
})

test('falls back to the canonical name when package.json is missing', async () => {
    const root = mkdtempSync(`${tmpdir()}/abide-import-name-`)
    roots.push(root)
    expect(await abideImportName(root)).toBe('@abide/abide')
})
