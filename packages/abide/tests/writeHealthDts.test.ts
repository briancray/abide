import { describe, expect, test } from 'bun:test'
import { writeHealthDts } from '../src/lib/shared/writeHealthDts.ts'

describe('writeHealthDts', () => {
    test('with an app module, augments AppHealthMap against the hook return type', async () => {
        const cwd = `${import.meta.dir}/.tmp-health-dts-${crypto.randomUUID().slice(0, 8)}`
        try {
            await writeHealthDts({ cwd, hasAppModule: true, importName: 'abide' })
            const output = await Bun.file(`${cwd}/src/.abide/health.d.ts`).text()
            expect(output).toContain("declare module '@abide/abide/shared/health'")
            expect(output).toContain('interface AppHealthMap')
            expect(output).toContain("typeof import('../app.ts')")
            // The hook is optional and may return non-objects; both degrade to no fields.
            expect(output).toContain('Record<never, never>')
        } finally {
            await Bun.$`rm -rf ${cwd}`.quiet()
        }
    })

    test('without an app module, emits no augmentation (the import would not resolve)', async () => {
        const cwd = `${import.meta.dir}/.tmp-health-dts-${crypto.randomUUID().slice(0, 8)}`
        try {
            await writeHealthDts({ cwd, hasAppModule: false, importName: 'abide' })
            const output = await Bun.file(`${cwd}/src/.abide/health.d.ts`).text()
            expect(output).not.toContain('declare module')
            expect(output).toContain('export {}')
        } finally {
            await Bun.$`rm -rf ${cwd}`.quiet()
        }
    })
})
