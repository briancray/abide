// EVERY CHAPTER APP PASSES ITS OWN TESTS AND ITS OWN CHECK, run as a reader who downloaded it runs
// them: from the app's directory, under its own `bunfig.toml`. A card's Tests view shows what these
// report, so a red one here is a card claiming a test the app fails.

import { expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { forwarded, forwardedDirectories } from '../scripts/forwardChapters.ts'
import { DOGFOOD } from './docsPages.ts'

const APPS: string[] = []
for (const manifest of new Bun.Glob('examples/*/package.json').scanSync({
    cwd: DOGFOOD,
}))
    APPS.push(manifest.slice('examples/'.length, -'/package.json'.length))

// CONCURRENT: each app's suite and check is a process of its own, and run one after another the ten
// set the gate's wall clock alone.
test.concurrent.each(APPS)(
    '%s passes its own tests and its own check',
    async (app) => {
        const cwd = `${DOGFOOD}examples/${app}`
        // A later chapter's suite runs every earlier chapter's cards: past `spawned`'s 60 s on a CI
        // runner, and still inside this test's own 120 s, so a hang fails naming the command.
        const tested = await spawned(['bun', 'test'], {
            cwd,
            deadline: 110_000,
        })
        expect(tested.exitCode, tested.stderr).toBe(0)
        const checked = await spawned(['bun', 'run', 'check'], { cwd })
        expect(checked.exitCode, checked.stdout + checked.stderr).toBe(0)
    },
    120_000,
)

// THE CRM SO FAR, AND WHAT `abide scaffold` WRITES TODAY: chapter N's app holds every earlier
// chapter's feature as that chapter left it, so the app a reader downloads at chapter 7 is chapters 1
// to 7 rather than a fork of them, and its root is the config, agent notes, scripts and stylesheet a
// new app has — a downloaded app that drifted from the scaffold teaches a setup no new app has. Every
// file `scripts/forwardChapters.ts` writes is compared to disk, and a forwarded feature directory
// holding a file the owner does not is named too. THE REVERT: edit a feature in the chapter that owns
// it, or a line of `bunfig.toml` in `scaffold.ts`, without running the script, and every later copy is
// named. The Dockerfile's `FROM` names the bun that ran the scaffold, so it is compared without it.
test('every chapter app is what `scripts/forwardChapters.ts` writes', async () => {
    const files = await forwarded()
    const withoutBase = (dockerfile: string) =>
        dockerfile.replace(/^FROM oven\/bun:\S+/, 'FROM oven/bun')
    const drifted: string[] = []
    for (const [path, text] of files) {
        const file = Bun.file(path)
        let ours = (await file.exists()) ? await file.text() : undefined
        let theirs = text
        if (path.endsWith('/Dockerfile') && ours !== undefined) {
            ours = withoutBase(ours)
            theirs = withoutBase(theirs)
        }
        if (ours !== theirs) drifted.push(path.slice(DOGFOOD.length))
    }
    for (const directory of forwardedDirectories())
        for (const file of new Bun.Glob('**').scanSync({
            cwd: directory,
            dot: true,
        }))
            if (!files.has(`${directory}/${file}`))
                drifted.push(`${directory}/${file}`.slice(DOGFOOD.length))
    expect(drifted).toEqual([])
}, 60_000)
