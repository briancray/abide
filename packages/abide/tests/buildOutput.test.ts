// 38.67 — TWO BUILDS INTO ONE `out` DO NOT CLASH. A build stages its bundle and moves each file in
// whole, and removes only what it did not produce that was written before it began — so a chunk a
// concurrent build wrote is left for that build's manifest, and a chunk no build names any more goes.

import { afterAll, expect, test } from 'bun:test'
import { utimesSync } from 'node:fs' // bun exposes no way to set a file's times of its own
import { appFixture, buildApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const PAGE = `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
</script>

<button onclick={() => { count = count + 1 }}>{count}</button>`

async function manifestNamesExist(out: string): Promise<boolean> {
    const manifest = (await Bun.file(`${out}/manifest.json`).json()) as {
        entry: string
        chunks: Record<string, string[]>
    }
    const names = [manifest.entry, ...Object.values(manifest.chunks).flat()]
    for (const name of names)
        if (!(await Bun.file(`${out}/client/${name}`).exists())) return false
    return names.length > 0
}

// THE REVERT: empty `client/` before the bundle, as the build did; `concurrent-1.js` is gone. Drop
// `pruneStale` and `stale-1.js` stands.
test('a build removes the stale chunks and keeps a concurrent build’s — 38.67', async () => {
    const app = appFixture({ 'ui/pages/page.abide': PAGE })
    const out = `${app}/.abide`
    expect((await buildApp(app)).exitCode).toBe(0)
    const now = Date.now() / 1000
    await Bun.write(`${out}/client/stale-1.js`, '')
    utimesSync(`${out}/client/stale-1.js`, now - 60, now - 60)
    await Bun.write(`${out}/client/concurrent-1.js`, '')
    utimesSync(`${out}/client/concurrent-1.js`, now + 60, now + 60)
    expect((await buildApp(app)).exitCode).toBe(0)
    expect(await Bun.file(`${out}/client/stale-1.js`).exists()).toBe(false)
    expect(await Bun.file(`${out}/client/concurrent-1.js`).exists()).toBe(true)
    expect(await manifestNamesExist(out)).toBe(true)
    expect([
        ...new Bun.Glob('.staging-*').scanSync({
            cwd: out,
            dot: true,
            onlyFiles: false,
        }),
    ]).toEqual([])
}, 60_000)

// A SMOKE TEST, NOT A GATE: the emptying revert above passes it too, both builds landing the same
// bytes last. It is here for the staging — two builds' directories and partial names never collide.
test('two builds of one tree into one out both finish, and what the manifest names is there — 38.67', async () => {
    const app = appFixture({ 'ui/pages/page.abide': PAGE })
    const out = `${app}/.abide`
    const both = await Promise.all([buildApp(app), buildApp(app)])
    expect(both.map((build) => build.exitCode)).toEqual([0, 0])
    expect(await manifestNamesExist(out)).toBe(true)
}, 60_000)
