// 38.195-38.203, 38.215 — AN APP'S NOTES FOR AN AGENT, AND `abide upgrade`, run as an author runs them: the
// CLI spawned over a fixture app whose `AGENTS.md` an earlier scaffold wrote and the app then added
// to. `before.md` is the scaffold's notes from before handlers were named `.handler.ts`, with the
// app's own lines among them; `after.md` is what the upgrade leaves.

import { afterAll, expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { paragraphsOf } from '#compiler/agentNotes.ts'
import { upgrade } from '#compiler/upgrade.ts'
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

// 38.215 — A PAGE'S SCRIPTS ARE ONE SCOPE: a body renamed in a `{#for}` row's own `<script>` is a
// `memo` the page's top-level script imports, and `reactive` stays imported for the row's other
// call. THE REVERT: hand each script block to `toMemo`'s module rewrite apart; the row's script
// imports nothing, so `memo` is never imported where only the row renamed a body, and the top-level
// script, calling `reactive` only over a body, drops `reactive` while the row still calls it.
test('a body renamed in a nested script is imported in the page script — 38.215', async () => {
    const app = temporaryModule({
        'src/Row.abide': `<script>
import { reactive } from '@abide/abide'

let rows = reactive([{ id: 1 }])
</script>

{#for row of rows key row.id}
    <script>
    const label = reactive(() => String(row.id))
    </script>
    <b>{label}</b>
{/for}
`,
        'src/index.abide': `<script>
import { reactive } from '@abide/abide'

let rows = reactive(() => [{ id: 1 }])
</script>

{#for row of rows key row.id}
    <script>
    const label = reactive(() => String(row.id))
    const count = reactive(0)
    </script>
    <b>{label}{count}</b>
{/for}
`,
    })
    const [row, edit] = await upgrade(app, '0.142.0')
    expect(row?.after).toBe(`<script>
import { memo, reactive } from '@abide/abide'

let rows = reactive([{ id: 1 }])
</script>

{#for row of rows key row.id}
    <script>
    const label = memo(() => String(row.id))
    </script>
    <b>{label}</b>
{/for}
`)
    expect(edit?.after).toBe(`<script>
import { memo, reactive } from '@abide/abide'

let rows = memo(() => [{ id: 1 }])
</script>

{#for row of rows key row.id}
    <script>
    const label = memo(() => String(row.id))
    const count = reactive(0)
    </script>
    <b>{label}{count}</b>
{/for}
`)
})

// 38.217 — `by` IS `key`, in a `{#for}` head and in the options a `reactive` or a `memo` is handed in
// place, in a page, a module and a Markdown fence. A `by` that is a name — the head's item, a member
// in its subject, the key's own name, an option of another call or of an object built apart — is
// left, and run again the migration changes nothing (38.200). THE REVERT: drop the `toKey`
// migration from `MIGRATIONS`; nothing is changed and `upgrade` answers no edits.
test('abide upgrade renames a by naming a key to key — 38.217, 38.200', async () => {
    const page = `<script>
import { memo, reactive } from '@abide/abide'

let rows = reactive([{ id: 1, by: 'me' }], { by: 'id' })
const by = (row: { id: number }) => row.id
const named = memo(() => rows, { by, tags: ['rows'] })
</script>

{#for row of rows by row.id}<b>{row.by}</b>{/for}
{#for item of group.by by item}<i>{item}</i>{/for}
{#for by of rows by by}<u>{by.id}</u>{/for}
{#for row of rows key by}<s>{row.id}</s>{/for}
`
    const module = `import { GET, memo, reactive } from '@abide/abide'

const OPTIONS = { by: 'id' }
export const books = GET(memo(() => [{ isbn: '1' }], { by: 'isbn' }))
export const kept = reactive<{ id: string }[]>([], {
    by(row) {
        return row.id
    },
})
export const built = reactive([], OPTIONS)
export const sorted = sortBy(rows, { by: 'id' })
`
    const notes = `# Rows

\`\`\`abide
<script>
const deals = reactive([], { by: 'id' })
</script>
{#for deal of deals by deal.id}<li>{deal.name}</li>{/for}
\`\`\`
`
    const app = temporaryModule({
        'src/index.abide': page,
        'src/lib/books.ts': module,
        'NOTES.md': notes,
    })
    const edits = await upgrade(app, '0.142.0')
    const after = (path: string) =>
        edits.find((edit) => edit.path === path)?.after
    expect(after('src/index.abide')).toBe(`<script>
import { memo, reactive } from '@abide/abide'

let rows = reactive([{ id: 1, by: 'me' }], { key: 'id' })
const by = (row: { id: number }) => row.id
const named = memo(() => rows, { key: by, tags: ['rows'] })
</script>

{#for row of rows key row.id}<b>{row.by}</b>{/for}
{#for item of group.by key item}<i>{item}</i>{/for}
{#for by of rows key by}<u>{by.id}</u>{/for}
{#for row of rows key by}<s>{row.id}</s>{/for}
`)
    expect(after('src/lib/books.ts'))
        .toBe(`import { GET, memo, reactive } from '@abide/abide'

const OPTIONS = { by: 'id' }
export const books = GET(memo(() => [{ isbn: '1' }], { key: 'isbn' }))
export const kept = reactive<{ id: string }[]>([], {
    key(row) {
        return row.id
    },
})
export const built = reactive([], OPTIONS)
export const sorted = sortBy(rows, { by: 'id' })
`)
    expect(after('NOTES.md')).toBe(`# Rows

\`\`\`abide
<script>
const deals = reactive([], { key: 'id' })
</script>
{#for deal of deals key deal.id}<li>{deal.name}</li>{/for}
\`\`\`
`)
    for (const edit of edits) await Bun.write(`${app}/${edit.path}`, edit.after)
    expect(await upgrade(app, '0.142.0')).toEqual([])
})

// 38.219 — A JOB'S NAME IS ONE OF ITS OPTIONS, AND `run` RUNS IT AHEAD OF SCHEDULE, in a module, a
// page and a Markdown fence, on its own line where the options' first property is. A `job` read as
// a member, one already handed its options alone, and a `runNow` that is not read as a member are
// left, and run again the migration changes nothing (38.200). THE REVERT: drop the `toJob`
// migration from `MIGRATIONS`; nothing is changed and `upgrade` answers no edits.
test('abide upgrade moves a job name into its options and renames runNow to run — 38.219, 38.200', async () => {
    const module = `import { job, POST } from '@abide/abide/server'

export const digest = job('digest', { every: 60_000, run: mail })
export const nightly = job(\`nightly\`, {
    every: 86_400_000,
    run: (signal) => sweep(signal),
})
export const named = job(NAME, { every: 0, run: mail })
export const queued = queue.job('kept', { run: mail })
export const moved = job({ name: 'moved', every: 0, run: mail })
const { runNow } = legacy
export default POST(() => digest.runNow(), { tags: ['digest'] })
export const maybe = () => nightly?.runNow()
`
    const page = `<script>
import { digest } from './lib/digest.server.ts'
</script>

<button onclick={() => digest.runNow()}>Send</button>
`
    const notes = `# Jobs

\`\`\`ts
job('score', { every: 300_000, run: scoreAll })
\`\`\`
`
    const app = temporaryModule({
        'src/lib/digest.server.ts': module,
        'src/index.abide': page,
        'NOTES.md': notes,
    })
    const edits = await upgrade(app, '0.143.0')
    const after = (path: string) =>
        edits.find((edit) => edit.path === path)?.after
    expect(after('src/lib/digest.server.ts'))
        .toBe(`import { job, POST } from '@abide/abide/server'

export const digest = job({ name: 'digest', every: 60_000, run: mail })
export const nightly = job({
    name: \`nightly\`,
    every: 86_400_000,
    run: (signal) => sweep(signal),
})
export const named = job({ name: NAME, every: 0, run: mail })
export const queued = queue.job('kept', { run: mail })
export const moved = job({ name: 'moved', every: 0, run: mail })
const { runNow } = legacy
export default POST(() => digest.run(), { tags: ['digest'] })
export const maybe = () => nightly?.run()
`)
    expect(after('src/index.abide')).toBe(`<script>
import { digest } from './lib/digest.server.ts'
</script>

<button onclick={() => digest.run()}>Send</button>
`)
    expect(after('NOTES.md')).toBe(`# Jobs

\`\`\`ts
job({ name: 'score', every: 300_000, run: scoreAll })
\`\`\`
`)
    for (const edit of edits) await Bun.write(`${app}/${edit.path}`, edit.after)
    expect(await upgrade(app, '0.143.0')).toEqual([])
})

// 38.221 — ANOTHER COMPONENT'S PARTS ARE A MEMBER NAMED FOR IT: `jump` read off a name bound to `chat`
// is `autoscroll.jump`, `progress` off a `wizard` is `meter`, `overflow` off `breadcrumbs` is `menu`,
// in a page's script and markup, a module and a Markdown fence. The same words read off any other
// name, and `'overflow'` as a value, are left, and run again it changes nothing (38.200). THE REVERT:
// drop the binding from `toNamedParts` and rename every `.jump`, and `scroller.jump` is renamed too.
test('abide upgrade renames the parts 49.18 named for their component — 38.221, 38.200', async () => {
    const page = `<script>
import { breadcrumbs, chat, wizard } from '@abide/abide'

const talk = chat({ ask })
let steps = wizard<string>({ steps: STEPS })
const crumbs = breadcrumbs({ trail, href })
const scroller = { jump: () => {} }
</script>

<ol {...talk.transcript}></ol>
<button {...talk.jump}>Latest</button>
<div {...steps.progress.meter}><i {...steps.progress.fill}></i></div>
{#for item of crumbs.items}{#if item === 'overflow'}<b {...crumbs.overflow.trigger}></b>{/if}{/for}
<button onclick={() => scroller.jump()}>Top</button>
<p {...talk.autoscroll.jump}></p>
`
    const module = `import { wizard } from '@abide/abide'

export const signup = wizard({ steps: ['a', 'b'] })
export const shown = () => signup?.progress.fraction
export const other = task.progress
`
    const notes = `# Chat

\`\`\`abide
<script>
const talk = chat({ ask })
</script>
<button {...talk.jump}>Latest</button>
\`\`\`
`
    const app = temporaryModule({
        'src/index.abide': page,
        'src/lib/signup.ts': module,
        'NOTES.md': notes,
    })
    const edits = await upgrade(app, '0.143.0')
    const after = (path: string) =>
        edits.find((edit) => edit.path === path)?.after
    expect(after('src/index.abide')).toBe(`<script>
import { breadcrumbs, chat, wizard } from '@abide/abide'

const talk = chat({ ask })
let steps = wizard<string>({ steps: STEPS })
const crumbs = breadcrumbs({ trail, href })
const scroller = { jump: () => {} }
</script>

<ol {...talk.transcript}></ol>
<button {...talk.autoscroll.jump}>Latest</button>
<div {...steps.meter.meter}><i {...steps.meter.fill}></i></div>
{#for item of crumbs.items}{#if item === 'overflow'}<b {...crumbs.menu.trigger}></b>{/if}{/for}
<button onclick={() => scroller.jump()}>Top</button>
<p {...talk.autoscroll.jump}></p>
`)
    expect(after('src/lib/signup.ts'))
        .toBe(`import { wizard } from '@abide/abide'

export const signup = wizard({ steps: ['a', 'b'] })
export const shown = () => signup?.meter.fraction
export const other = task.progress
`)
    expect(after('NOTES.md')).toBe(`# Chat

\`\`\`abide
<script>
const talk = chat({ ask })
</script>
<button {...talk.autoscroll.jump}>Latest</button>
\`\`\`
`)
    for (const edit of edits) await Bun.write(`${app}/${edit.path}`, edit.after)
    expect(await upgrade(app, '0.143.0')).toEqual([])
})

// 38.222 — A REFUSAL IS DECLARED BY ITS NAME AND ITS OPTIONS, its status beside its message and its
// schema: in a module and a Markdown fence, on one line where the call was and one property to a
// line where it was one argument to a line, past any type arguments. An argument written `undefined` is dropped, options
// held by a name are spread, and a call already handed its options or its name alone is left — run
// again, the migration changes nothing (38.200). THE REVERT: drop the `toRefuseNamed` migration from
// `MIGRATIONS`; nothing is changed and `upgrade` answers no edits.
test('abide upgrade moves a refusal status and message into its options — 38.222, 38.200', async () => {
    const module = `import { jsonSchema, refuse } from '@abide/abide'

export const signedOut = refuse.named('SignedOut', 401, 'Sign in first.')
export const late = refuse.named('Late', 410)
export const typed = refuse.named<'Typed'>('Typed', 409)
export const shaped = refuse.named('Shaped', 422, undefined, shape)
export const closed = refuse.named(
    'DealClosed',
    409,
    'A closed deal does not move.',
    { schema: jsonSchema<{ stage: string }>({ type: 'object' }) },
)
export const plain = refuse.named('Plain')
export const moved = refuse.named('Moved', { status: 409 })
`
    const notes = `# Refusals

\`\`\`ts
const busy = refuse.named('Busy', 409, 'Try again.')
\`\`\`
`
    const app = temporaryModule({
        'src/lib/refusals.ts': module,
        'NOTES.md': notes,
    })
    const edits = await upgrade(app, '0.143.0')
    const after = (path: string) =>
        edits.find((edit) => edit.path === path)?.after
    expect(after('src/lib/refusals.ts'))
        .toBe(`import { jsonSchema, refuse } from '@abide/abide'

export const signedOut = refuse.named('SignedOut', { status: 401, message: 'Sign in first.' })
export const late = refuse.named('Late', { status: 410 })
export const typed = refuse.named<'Typed'>('Typed', { status: 409 })
export const shaped = refuse.named('Shaped', { status: 422, ...shape })
export const closed = refuse.named('DealClosed', {
    status: 409,
    message: 'A closed deal does not move.',
    schema: jsonSchema<{ stage: string }>({ type: 'object' }),
})
export const plain = refuse.named('Plain')
export const moved = refuse.named('Moved', { status: 409 })
`)
    expect(after('NOTES.md')).toBe(`# Refusals

\`\`\`ts
const busy = refuse.named('Busy', { status: 409, message: 'Try again.' })
\`\`\`
`)
    for (const edit of edits) await Bun.write(`${app}/${edit.path}`, edit.after)
    expect(await upgrade(app, '0.143.0')).toEqual([])
})
