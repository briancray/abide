// EVERY CHAPTER APP PASSES ITS OWN TESTS AND ITS OWN CHECK, run as a reader who downloaded it runs
// them: from the app's directory, under its own `bunfig.toml`. A card's Tests view shows what these
// report, so a red one here is a card claiming a test the app fails.

import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises' // bun exposes no temporary directory or recursive removal
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { spawned } from '@abide/harness/gate'

import { CHAPTER_FEATURES } from '../scripts/CHAPTER_FEATURES.ts'
import { DOGFOOD } from './docsPages.ts'

const appOf = (chapter: number) => `crm-${String(chapter).padStart(2, '0')}`

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
        const tested = await spawned(['bun', 'test'], { cwd })
        expect(tested.exitCode, tested.stderr).toBe(0)
        const checked = await spawned(['bun', 'run', 'check'], { cwd })
        expect(checked.exitCode, checked.stdout + checked.stderr).toBe(0)
    },
    120_000,
)

// THE CRM SO FAR: chapter N's app holds every earlier chapter's feature as that chapter left it, so
// the app a reader downloads at chapter 7 is chapters 1 to 7 rather than a fork of them. THE REVERT:
// edit a feature in the chapter that owns it without running `scripts/forwardChapters.ts`, and every
// later copy is named.
test("every later chapter app carries an earlier chapter's feature as that chapter left it", async () => {
    const drifted: string[] = []
    for (let chapter = 1; chapter <= CHAPTER_FEATURES.length; chapter += 1) {
        const [feature] = CHAPTER_FEATURES[chapter - 1] as [string, string]
        const owner = `${DOGFOOD}examples/${appOf(chapter)}/src/${feature}`
        const files = [...new Bun.Glob('**').scanSync({ cwd: owner })].sort()
        for (let later = chapter + 1; later <= APPS.length; later += 1) {
            const copy = `${DOGFOOD}examples/${appOf(later)}/src/${feature}`
            const copied = [
                ...new Bun.Glob('**').scanSync({ cwd: copy }),
            ].sort()
            if (copied.join('\n') !== files.join('\n')) {
                drifted.push(`${appOf(later)}/src/${feature}: files differ`)
                continue
            }
            for (const file of files)
                if (
                    (await Bun.file(`${owner}/${file}`).text()) !==
                    (await Bun.file(`${copy}/${file}`).text())
                )
                    drifted.push(`${appOf(later)}/src/${feature}/${file}`)
        }
    }
    expect(drifted).toEqual([])
})

// EVERY CHAPTER APP IS WHAT `abide scaffold` WRITES TODAY, at its root: the config, the agent notes,
// the scripts and the stylesheet's tooling a new app has, and chapter 1's stylesheet. A downloaded
// app that drifted from the scaffold teaches the reader a setup no new app has. THE REVERT: change
// a script or a line of `bunfig.toml` in `scaffold.ts` without running `scripts/forwardChapters.ts`,
// and every app is named. The Dockerfile's `FROM` names the bun that ran the scaffold, so it is
// compared without it.
test('every chapter app has the root files `abide scaffold` writes', async () => {
    const temporary = await mkdtemp(`${tmpdir()}/abide-starter-`)
    try {
        const scaffolded = await spawned(
            [
                process.execPath,
                `${DOGFOOD}../abide/bin/abide.ts`,
                'scaffold',
                'starter',
            ],
            { cwd: temporary },
        )
        expect(scaffolded.exitCode, scaffolded.stderr).toBe(0)
        const starter = `${temporary}/starter`
        const withoutBase = (dockerfile: string) =>
            dockerfile.replace(/^FROM oven\/bun:\S+/, 'FROM oven/bun')
        const starterManifest = await Bun.file(`${starter}/package.json`).json()
        const drifted: string[] = []
        for (const app of APPS) {
            const root = `${DOGFOOD}examples/${app}`
            for (const file of [
                'bunfig.toml',
                '.dockerignore',
                '.gitignore',
                'CLAUDE.md',
                'Dockerfile',
            ]) {
                let theirs = await Bun.file(`${starter}/${file}`).text()
                let ours = await Bun.file(`${root}/${file}`).text()
                if (file === 'Dockerfile') {
                    theirs = withoutBase(theirs)
                    ours = withoutBase(ours)
                }
                if (ours !== theirs) drifted.push(`${app}/${file}`)
            }
            const manifest = await Bun.file(`${root}/package.json`).json()
            if (
                JSON.stringify(manifest.scripts) !==
                JSON.stringify(starterManifest.scripts)
            )
                drifted.push(`${app}/package.json scripts`)
            if (
                JSON.stringify(manifest.devDependencies) !==
                JSON.stringify({
                    ...starterManifest.devDependencies,
                    '@abide/harness': 'workspace:*',
                })
            )
                drifted.push(`${app}/package.json devDependencies`)
            for (const file of ['app.css', 'crm.css'])
                if (
                    (await Bun.file(`${root}/src/lib/${file}`).text()) !==
                    (await Bun.file(
                        `${DOGFOOD}examples/${appOf(1)}/src/lib/${file}`,
                    ).text())
                )
                    drifted.push(`${app}/src/lib/${file}`)
        }
        expect(drifted).toEqual([])
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
})
