// 38.195-38.203, 38.215 — AN APP'S NOTES FOR AN AGENT, AND `abide upgrade`, run as an author runs them: the
// CLI spawned over a fixture app whose `AGENTS.md` an earlier scaffold wrote and the app then added
// to. `before.md` is the scaffold's notes from before handlers were named `.handler.ts`, with the
// app's own lines among them; `after.md` is what the upgrade leaves.

import { afterAll, expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { paragraphsOf } from '#compiler/agentNotes.ts'
import { ABIDE_DIRECTORY } from '#server/ABIDE_DIRECTORY.ts'

import { BIN } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BEFORE = await Bun.file(
    new URL('./fixtures/upgrade/before.md', import.meta.url),
).text()
const AFTER = await Bun.file(
    new URL('./fixtures/upgrade/after.md', import.meta.url),
).text()

// The lines of `before.md` that open a paragraph an earlier scaffold wrote. Line 14, the app's own,
// sits between them, as do `bun run seed` (25), a handler line reworded for the app (37), and a
// fence holding a scaffold line word for word (57).
const RESTATED_LINES = [3, 6, 9, 11, 18, 26, 27, 31, 34, 38, 42, 49]

function fixtureApp(notes: string | undefined): string {
    const files: Record<string, string> = {
        'package.json': JSON.stringify({ name: 'ledger', type: 'module' }),
        'src/index.abide': '<main>home</main>',
    }
    if (notes !== undefined) files['AGENTS.md'] = notes
    return temporaryModule(files)
}

const abide = (app: string, ...words: string[]) =>
    spawned(['bun', BIN, ...words], { cwd: app })

afterAll(removeTemporaryModules)

// 38.196, 38.197 — EVERY PARAGRAPH WORD FOR WORD THE SCAFFOLD'S, AND NO OTHER, a warning, which
// leaves the exit alone (38.32). THE REVERT: drop `agentNoteFindings` from `check` in bin/abide.ts,
// and no line is warned at; drop the fence branch from `paragraphsOf`, and line 57 is warned at too.
test('abide check warns at each paragraph AGENTS.md restates of abide — 38.196, 38.197', async () => {
    const app = fixtureApp(BEFORE)
    const checked = await abide(app, 'check')
    const warned: number[] = []
    for (const match of checked.stdout.matchAll(
        /^AGENTS\.md:(\d+):1 - warning: .*RULEBOOK 38\.196\.$/gm,
    ))
        warned.push(Number(match[1]))
    expect(warned).toEqual(RESTATED_LINES)
    expect(checked.exitCode).toBe(0)
}, 30_000)

// 38.201 — THE DIFF, AND NOTHING WRITTEN. The diff is one `git apply` takes: applied to the notes as
// they were, it makes what `abide upgrade` writes. THE REVERT: write under `--check` too, and the
// file is `after.md`; return 0 from it, and the exit is 0.
test('abide upgrade --check prints the diff, writes nothing and fails — 38.201', async () => {
    const app = fixtureApp(BEFORE)
    const checked = await abide(app, 'upgrade', '--check')
    expect(checked.exitCode).toBe(1)
    expect(await Bun.file(`${app}/AGENTS.md`).text()).toBe(BEFORE)
    expect(checked.stdout).toContain('--- a/AGENTS.md\n+++ b/AGENTS.md\n@@ ')
    expect(checked.stdout).toContain('abide upgrade: 1 file would change')
    await Bun.write(
        `${app}/upgrade.diff`,
        checked.stdout.slice(0, checked.stdout.lastIndexOf('abide upgrade:')),
    )
    const applied = await spawned(['git', 'apply', 'upgrade.diff'], {
        cwd: app,
    })
    expect(applied.stderr).toBe('')
    expect(await Bun.file(`${app}/AGENTS.md`).text()).toBe(AFTER)
}, 30_000)

// 38.200, 38.202, 38.203 — THE SCAFFOLD'S PARAGRAPHS GONE, the app's kept, `## Habits` gone with
// everything under it, and the scaffold's pointer to `ABIDE.md` under the title; then nothing left to
// change, and nothing left for `abide check` to warn at. THE REVERT: drop the heading pass from
// `withoutRestatedNotes`, and `## Habits` stays; drop the pointer, and the file opens on the ledger.
test('abide upgrade strips what an earlier scaffold wrote into AGENTS.md, once — 38.200, 38.202, 38.203', async () => {
    const app = fixtureApp(BEFORE)
    const upgraded = await abide(app, 'upgrade')
    expect(upgraded.exitCode).toBe(0)
    expect(upgraded.stdout).toContain('abide upgrade: 1 file changed')
    expect(await Bun.file(`${app}/AGENTS.md`).text()).toBe(AFTER)
    const again = await abide(app, 'upgrade', '--check')
    expect(again.stdout).toBe('abide upgrade: nothing to change\n')
    expect(again.exitCode).toBe(0)
    const checked = await abide(app, 'check')
    expect(checked.stdout).not.toContain('AGENTS.md')
}, 30_000)

// 38.198 — A MIGRATION KEYED TO A RELEASE THE APP IS ALREADY PAST IS NOT APPLIED. THE REVERT: drop the
// `from` comparison from `upgrade`, and `--from 0.140.0` strips the notes.
test('abide upgrade applies only the migrations after --from — 38.198', async () => {
    const app = fixtureApp(BEFORE)
    const past = await abide(app, 'upgrade', '--check', '--from', '0.140.0')
    expect(past.stdout).toBe('abide upgrade: nothing to change\n')
    expect(past.exitCode).toBe(0)
    const before = await abide(app, 'upgrade', '--check', '--from', '0.139.0')
    expect(before.exitCode).toBe(1)
    const refused = await abide(app, 'upgrade', '--from', 'latest')
    expect(refused.exitCode).toBe(1)
    expect(refused.stderr).toContain('--from takes a release')
}, 30_000)

// 38.199 — WHAT NO RELEASE REPLACED IS LEFT AS IT IS: the notes `abide scaffold` writes now, notes
// that restate nothing and hold no pointer, and an app with no notes at all. THE REVERT: put the
// pointer in whatever restates nothing, and the second app is changed.
test('abide upgrade changes nothing written in no earlier form — 38.199', async () => {
    const scaffolded = await Bun.file(
        `${ABIDE_DIRECTORY}scaffold/AGENTS.md`,
    ).text()
    const own = '# Notes\n\nThe ledger keeps one book per household.\n'
    for (const notes of [scaffolded, own, undefined]) {
        const app = fixtureApp(notes)
        const upgraded = await abide(app, 'upgrade', '--check')
        expect(upgraded.stdout).toBe('abide upgrade: nothing to change\n')
    }
}, 30_000)

// 38.195 — THE STARTER'S NOTES HOLD THE POINTER AND THE APP'S OWN LINES, and no paragraph `ABIDE.md`
// holds. THE REVERT: paste a bullet of `ABIDE.md` into `scaffold/AGENTS.md`, and it is named here.
test('the AGENTS.md abide scaffold writes states nothing of abide but where ABIDE.md is — 38.195', async () => {
    const owned = new Set<string>()
    for (const paragraph of paragraphsOf(
        (await Bun.file(`${ABIDE_DIRECTORY}ABIDE.md`).text()).split('\n'),
    ))
        if (!paragraph.heading) owned.add(paragraph.text)
    const notes = paragraphsOf(
        (await Bun.file(`${ABIDE_DIRECTORY}scaffold/AGENTS.md`).text()).split(
            '\n',
        ),
    )
    const restated: string[] = []
    for (const paragraph of notes)
        if (owned.has(paragraph.text)) restated.push(paragraph.text)
    expect(restated).toEqual([])
    // the one paragraph above the app's own section is the pointer
    const opening: string[] = []
    for (const paragraph of notes) {
        if (paragraph.text === '## This app') break
        if (!paragraph.heading) opening.push(paragraph.text)
    }
    expect(opening).toHaveLength(1)
    expect(opening[0]).toContain('`node_modules/@abide/abide/ABIDE.md`')
})

// 38.215 — A BODY HANDED TO `reactive` IS HANDED TO `memo`, in a module and in a page's script, and
// `memo` is imported beside what is still a `reactive`. A value is left, and a name bound to a body
// is read as one. Run again it changes nothing (38.200). THE REVERT: drop the 0.143.0 migration from
// `MIGRATIONS`, and `abide upgrade: nothing to change`.
test('abide upgrade hands a body written for reactive to memo — 38.215, 38.200', async () => {
    const app = temporaryModule({
        'package.json': JSON.stringify({ name: 'ledger', type: 'module' }),
        'src/lib/totals.ts': `import { reactive } from '@abide/abide'

const score = (args: { id: string }) => args.id.length
export const seats = reactive(5)
export const total = reactive(() => seats() * 40)
export const scored = reactive(score)
`,
        'src/index.abide': `<script>
import { reactive } from '@abide/abide'

let q = reactive('')
const found = reactive(async () => q.toUpperCase())
</script>

<input bind:value={q}><p>{found}</p>`,
    })
    const upgraded = await abide(app, 'upgrade')
    expect(upgraded.stdout).toContain('abide upgrade: 2 files changed')
    expect(await Bun.file(`${app}/src/lib/totals.ts`).text())
        .toBe(`import { memo, reactive } from '@abide/abide'

const score = (args: { id: string }) => args.id.length
export const seats = reactive(5)
export const total = memo(() => seats() * 40)
export const scored = memo(score)
`)
    expect(await Bun.file(`${app}/src/index.abide`).text()).toBe(`<script>
import { memo, reactive } from '@abide/abide'

let q = reactive('')
const found = memo(async () => q.toUpperCase())
</script>

<input bind:value={q}><p>{found}</p>`)
    const again = await abide(app, 'upgrade', '--check')
    expect(again.stdout).toBe('abide upgrade: nothing to change\n')
}, 30_000)
