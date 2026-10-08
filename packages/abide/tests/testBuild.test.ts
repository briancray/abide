// 42.16 — A TEST BUILD IS MADE ONCE PER STATE OF THE APP'S SOURCES, and every process asking for that
// state reuses it. Counted rather than timed: a build that ran twice still answers the right
// directory.

import { afterAll, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises' // bun exposes no directory listing of its own
import { spawned } from 'harness/gate'
import { sharedBuild, sourceHash } from '#server/testBuild.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

// THE REVERT: make `claim` answer true unconditionally — every caller builds, 6 where 1 is due.
test('callers asking for one build at once make it once — 42.16', async () => {
    const builds = temporaryModule({})
    let made = 0
    const build = async (out: string): Promise<void> => {
        made += 1
        await Bun.sleep(100)
        await Bun.write(`${out}/built.txt`, 'built')
    }
    const answered = await Promise.all(
        Array.from({ length: 6 }, () =>
            sharedBuild(builds, 'build-one', build),
        ),
    )
    expect(made).toBe(1)
    expect(new Set(answered)).toEqual(new Set([`${builds}/build-one`]))
    expect(await readdir(builds)).toEqual(['build-one'])
})

// THE REVERT: drop the `holderEnded` takeover — the caller waits on the dead holder's lock forever,
// and the test times out.
test('a lock whose holder has ended is taken over — 42.16', async () => {
    const builds = temporaryModule({})
    const ended = await spawned(['bun', '-e', 'console.log(process.pid)'])
    await Bun.write(`${builds}/build-orphaned.lock`, ended.stdout.trim())
    const out = await sharedBuild(builds, 'build-orphaned', async (staging) => {
        await Bun.write(`${staging}/built.txt`, 'built')
    })
    expect(await Bun.file(`${out}/built.txt`).text()).toBe('built')
}, 5_000)

// THE REVERT: hash the paths and not their bytes — an edited page keeps its key, and the old build
// is served for it.
test("an edit to the app's source is a new build, and no edit is the same one — 42.16", async () => {
    const app = temporaryModule({
        'ui/pages/page.abide': '<main>before</main>',
    })
    const first = await sourceHash(app)
    expect(await sourceHash(app)).toBe(first)
    await Bun.write(`${app}/ui/pages/page.abide`, '<main>after</main>')
    expect(await sourceHash(app)).not.toBe(first)
})
