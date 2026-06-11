import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { devClientFingerprint } from '../src/lib/server/runtime/devClientFingerprint.ts'

let dir: string | undefined

afterEach(() => {
    if (dir) {
        rmSync(dir, { recursive: true, force: true })
        dir = undefined
    }
})

/* A throwaway dist/_app + public tree the fingerprint can scan. */
async function makeTree(): Promise<{ distDir: string; publicDir: string }> {
    dir = mkdtempSync(`${tmpdir()}/belte-fingerprint-`)
    mkdirSync(`${dir}/dist/_app`, { recursive: true })
    mkdirSync(`${dir}/public`, { recursive: true })
    await Bun.write(`${dir}/dist/_app/client-abc.js`, 'client code')
    await Bun.write(`${dir}/public/logo.png`, 'png bytes')
    return { distDir: `${dir}/dist`, publicDir: `${dir}/public` }
}

describe('devClientFingerprint', () => {
    test('is stable across rebuilds that leave content unchanged', async () => {
        const tree = await makeTree()
        const before = await devClientFingerprint({ ...tree, shell: '<html/>' })
        // A rebuild rewrites _app files (fresh mtime, same bytes) — must not reload.
        await Bun.write(`${tree.distDir}/_app/client-abc.js`, 'client code')
        const after = await devClientFingerprint({ ...tree, shell: '<html/>' })
        expect(after).toBe(before)
    })

    test('changes when an _app file changes content under the same name', async () => {
        const tree = await makeTree()
        const before = await devClientFingerprint({ ...tree, shell: '<html/>' })
        await Bun.write(`${tree.distDir}/_app/client-abc.js`, 'new client code')
        const after = await devClientFingerprint({ ...tree, shell: '<html/>' })
        expect(after).not.toBe(before)
    })

    test('changes when a public file is touched', async () => {
        const tree = await makeTree()
        const before = await devClientFingerprint({ ...tree, shell: '<html/>' })
        const later = new Date(Date.now() + 5000)
        utimesSync(`${tree.publicDir}/logo.png`, later, later)
        const after = await devClientFingerprint({ ...tree, shell: '<html/>' })
        expect(after).not.toBe(before)
    })

    test('changes when the shell changes', async () => {
        const tree = await makeTree()
        const before = await devClientFingerprint({ ...tree, shell: '<html/>' })
        const after = await devClientFingerprint({ ...tree, shell: '<html><body/></html>' })
        expect(after).not.toBe(before)
    })

    test('tolerates missing dist and public directories', async () => {
        dir = mkdtempSync(`${tmpdir()}/belte-fingerprint-`)
        const fingerprint = await devClientFingerprint({
            distDir: `${dir}/dist`,
            publicDir: `${dir}/public`,
            shell: '<html/>',
        })
        expect(fingerprint).toBeString()
    })
})
