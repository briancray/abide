import { afterEach, describe, expect, test } from 'bun:test'
import { scaffold } from '../src/scaffold.ts'

const TEMP_ROOT = `${import.meta.dir}/.scaffold-test-tmp`

afterEach(async () => {
    await Bun.$`rm -rf ${TEMP_ROOT}`.quiet()
})

describe('scaffold', () => {
    test('pins abide to the version of the CLI that scaffolded', async () => {
        const target = await scaffold({ cwd: TEMP_ROOT, name: 'app', install: false })
        const manifest = await Bun.file(`${target}/package.json`).json()
        const { name, version } = await Bun.file(
            new URL('../package.json', import.meta.url).pathname,
        ).json()
        expect(manifest.dependencies[name]).toBe(`^${version}`)
    })

    test('refuses a non-empty target directory', async () => {
        await Bun.write(`${TEMP_ROOT}/taken/existing.txt`, 'occupied')
        expect(scaffold({ cwd: TEMP_ROOT, name: 'taken' })).rejects.toThrow('not empty')
    })
})
