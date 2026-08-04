// `abide dev`'s rebuild must actually re-read the project's `.ts` modules.
//
// The module registry is keyed on the resolved path and nothing evicts it, so a second `loadApp` on the
// same directory in one process used to hand back the identical namespaces — the identical `Route`
// objects, the identical `middleware` array. The watcher fired, `App.rebind()` ran, the browser did a
// full reload, and the server went on executing the PREVIOUS handler for the rest of the session.

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadApp } from './loadApp.ts'

// The fixture lives in a temp dir outside the workspace, so `abide/server/GET` does not resolve there.
// An absolute specifier keeps the fixture a REAL module load (which is the whole point) with no install.
const GET_MODULE = join(import.meta.dir, '..', 'GET.ts')

const dirs: string[] = []

afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

async function project(): Promise<string> {
    const dir = join(tmpdir(), `abide-reload-${Bun.randomUUIDv7()}`)
    dirs.push(dir)
    await mkdir(join(dir, 'src', 'server', 'rpc'), { recursive: true })
    await Bun.write(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'reload-fixture', version: '0.0.0' }),
    )
    return dir
}

async function writeGreet(dir: string, message: string): Promise<void> {
    await Bun.write(
        join(dir, 'src', 'server', 'rpc', 'greet.ts'),
        `import { GET } from '${GET_MODULE}'\nexport const greet = GET(() => ({ msg: '${message}' }))\n`,
    )
}

describe('loadApp — reload', () => {
    test('a reload load sees an edit the module registry has already cached', async () => {
        const dir = await project()
        await writeGreet(dir, 'ONE')

        const first = await loadApp(dir, { schemas: 'source' })
        expect(await first.routes?.greet?.({})).toEqual({ msg: 'ONE' })

        await writeGreet(dir, 'TWO')

        // The default (load-once) lane is unchanged and still answers from the registry.
        const cached = await loadApp(dir, { schemas: 'source' })
        expect(await cached.routes?.greet?.({})).toEqual({ msg: 'ONE' })
        expect(cached.routes?.greet).toBe(first.routes?.greet)

        // The dev lane re-imports and gets the edit — and a FRESH callable, which is what makes
        // `App.rebind()` rebind something.
        const reloaded = await loadApp(dir, { schemas: 'source', reload: true })
        expect(await reloaded.routes?.greet?.({})).toEqual({ msg: 'TWO' })
        expect(reloaded.routes?.greet).not.toBe(first.routes?.greet)
    })

    test('a reload load re-reads src/app.ts middleware too', async () => {
        const dir = await project()
        await writeGreet(dir, 'ONE')
        const appFile = join(dir, 'src', 'app.ts')
        await Bun.write(appFile, 'export const middleware = []\n')

        const first = await loadApp(dir, { schemas: 'source' })
        expect(first.middleware).toHaveLength(0)

        await Bun.write(appFile, 'export const middleware = [(next) => next(), (next) => next()]\n')
        const reloaded = await loadApp(dir, { schemas: 'source', reload: true })
        expect(reloaded.middleware).toHaveLength(2)
    })
})
