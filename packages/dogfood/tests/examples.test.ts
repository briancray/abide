// EVERY CHAPTER APP PASSES ITS OWN TESTS AND ITS OWN CHECK, run as a reader who downloaded it runs
// them: from the app's directory, under its own `bunfig.toml`. A card's Tests view shows what these
// report, so a red one here is a card claiming a test the app fails.

import { expect, test } from 'bun:test'
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
