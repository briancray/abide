import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { writePublicAssetsDts } from '../src/lib/shared/writePublicAssetsDts.ts'

let dir: string | undefined

afterEach(() => {
    if (dir) {
        rmSync(dir, { recursive: true, force: true })
        dir = undefined
    }
})

async function generate(publicFiles: string[]): Promise<string> {
    dir = mkdtempSync(`${tmpdir()}/abide-publicdts-`)
    await writePublicAssetsDts({ cwd: dir, publicFiles, importName: '@abide/abide' })
    return Bun.file(`${dir}/src/.abide/publicAssets.d.ts`).text()
}

describe('writePublicAssetsDts', () => {
    test('keys each public file by its site-root path', async () => {
        const dts = await generate(['logo.png', 'fonts/inter.woff2'])
        expect(dts).toContain("declare module '@abide/abide/shared/url'")
        expect(dts).toContain('interface PublicAssets {')
        expect(dts).toContain('"/logo.png": true')
        expect(dts).toContain('"/fonts/inter.woff2": true')
    })

    test('emits an inert empty interface when public/ is empty', async () => {
        const dts = await generate([])
        expect(dts).toContain('interface PublicAssets {')
        expect(dts).not.toContain(': true')
    })
})
