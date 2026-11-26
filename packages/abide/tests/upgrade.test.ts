// 38.195-38.203, 38.215 — AN APP'S NOTES FOR AN AGENT, AND `abide upgrade`, run as an author runs them: the
// CLI spawned over a fixture app whose `AGENTS.md` an earlier scaffold wrote and the app then added
// to. `before.md` is the scaffold's notes from before handlers were named `.handler.ts`, with the
// app's own lines among them; `after.md` is what the upgrade leaves.

import { afterAll, expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { paragraphsOf } from '#compiler/agentNotes.ts'
import { toComputed } from '#compiler/toComputed.ts'
import { toComputedCall } from '#compiler/toComputedCall.ts'
import { toDerived } from '#compiler/toDerived.ts'
import { toFetchAndHandle } from '#compiler/toFetchAndHandle.ts'
import { toMemo } from '#compiler/toMemo.ts'
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
export const total = reactive.derived(() => seats() * 40)
export const scored = memo(score)
`)
    expect(await Bun.file(`${app}/src/index.abide`).text()).toBe(`<script>
import { reactive } from '@abide/abide'

let q = reactive('')
const found = reactive.derived(async () => q.toUpperCase())
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
import { reactive } from '@abide/abide'

let rows = reactive([{ id: 1 }])
</script>

{#for row of rows key row.id}
    <script>
    const label = reactive.derived(() => String(row.id))
    </script>
    <b>{label}</b>
{/for}
`)
    expect(edit?.after).toBe(`<script>
import { reactive } from '@abide/abide'

let rows = reactive.derived(() => [{ id: 1 }])
</script>

{#for row of rows key row.id}
    <script>
    const label = reactive.derived(() => String(row.id))
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
    // 38.223 leaves the tagged body a `memo`: a `computed` takes no `tags` (11.81).
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
        .toBe(`import { GET, reactive } from '@abide/abide'

const OPTIONS = { by: 'id' }
export const books = GET(reactive.derived(() => [{ isbn: '1' }], { key: 'isbn' }))
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

// 38.221 — `playback`'s `speed` is its `toggleGroup`, and every member `lightbox` laid flat from its
// carousel is its `carousel`'s, read in a page's markup and script and a module; its own `dialog`,
// `backdrop`, `open` and `show` stay, as do the same words read off any other name — `stage.next`,
// `speed` off a plain object — and run again it changes nothing (38.200). THE REVERT: drop the
// `lightbox` row from `toNamedParts`, and `viewer.previous` is left flat.
test("abide upgrade hands playback's toggleGroup and lightbox's carousel back by name — 38.221, 38.200", async () => {
    const page = `<script>
import { lightbox, playback } from '@abide/abide'

const viewer = lightbox({ items: PAGES })
const replay = playback({ duration: 12_000 })
const stage = { next: () => {}, speed: 1 }
</script>

<button onclick={() => viewer.show('Terms')}>Read</button>
<dialog {...viewer.dialog}>
    <div {...viewer.backdrop}>
        <ul {...viewer.host}>
            {#for page of PAGES key page}<li {...viewer.item(page)}>{page}</li>{/for}
        </ul>
        <button {...viewer.previous}>‹</button>
        <button {...viewer.next}>›</button>
        <p>{viewer.current} {viewer.playing() ? 'on' : 'off'}</p>
    </div>
</dialog>
<div {...replay.speed.group}>
    {#for rate of [0.5, 1, 2] key rate}<button {...replay.speed.item(rate)}>{rate}×</button>{/for}
</div>
<button onclick={() => stage.next()}>{stage.speed}</button>
`
    const module = `import { lightbox } from '@abide/abide'

export const viewer = lightbox({ items: ['a', 'b'] })
export const reset = () => {
    viewer.selected.set('a')
    viewer.scrollTo(viewer.id)
    viewer.reset()
    viewer.open.set(false)
}
`
    const app = temporaryModule({
        'src/index.abide': page,
        'src/lib/viewer.ts': module,
    })
    const edits = await upgrade(app, '0.143.0')
    const after = (path: string) =>
        edits.find((edit) => edit.path === path)?.after
    expect(after('src/index.abide')).toBe(`<script>
import { lightbox, playback } from '@abide/abide'

const viewer = lightbox({ items: PAGES })
const replay = playback({ duration: 12_000 })
const stage = { next: () => {}, speed: 1 }
</script>

<button onclick={() => viewer.show('Terms')}>Read</button>
<dialog {...viewer.dialog}>
    <div {...viewer.backdrop}>
        <ul {...viewer.carousel.host}>
            {#for page of PAGES key page}<li {...viewer.carousel.item(page)}>{page}</li>{/for}
        </ul>
        <button {...viewer.carousel.previous}>‹</button>
        <button {...viewer.carousel.next}>›</button>
        <p>{viewer.carousel.current} {viewer.carousel.playing() ? 'on' : 'off'}</p>
    </div>
</dialog>
<div {...replay.toggleGroup.group}>
    {#for rate of [0.5, 1, 2] key rate}<button {...replay.toggleGroup.item(rate)}>{rate}×</button>{/for}
</div>
<button onclick={() => stage.next()}>{stage.speed}</button>
`)
    expect(after('src/lib/viewer.ts'))
        .toBe(`import { lightbox } from '@abide/abide'

export const viewer = lightbox({ items: ['a', 'b'] })
export const reset = () => {
    viewer.carousel.selected.set('a')
    viewer.carousel.scrollTo(viewer.carousel.id)
    viewer.carousel.reset()
    viewer.open.set(false)
}
`)
    for (const edit of edits) await Bun.write(`${app}/${edit.path}`, edit.after)
    expect(await upgrade(app, '0.143.0')).toEqual([])
})

// 38.215 — `memo` JOINS ABIDE'S IMPORT ALONE: a module importing a `reactive` of its own from another
// module before abide's keeps that import as it is. THE REVERT: match any `import { … reactive … }`
// in `withMemoImported`; `./signals.ts`' import gains `memo` and abide's does not.
test("memo is imported beside abide's reactive, never an app's own — 38.215", () => {
    const text = `import { reactive } from './signals.ts'
import { reactive, watch } from '@abide/abide'

export const total = reactive(() => 1)
export const kept = reactive(0)
`
    expect(toMemo(text, 'src/lib/total.ts'))
        .toBe(`import { reactive } from './signals.ts'
import { memo, reactive, watch } from '@abide/abide'

export const total = memo(() => 1)
export const kept = reactive(0)
`)
})

// 38.223 — A BODY DECLARING NO PARAMETER IS HANDED TO `computed`, and one declaring a parameter stays
// a `memo`: written in place as an arrow, an async arrow, a function and a generator, each beside a
// keyed one, in a module whose `memo` stays imported for the keyed one. THE REVERT: accept every
// body in `isBodyWithoutParameter`; the keyed `memo` is renamed too, and `memo` leaves the import.
test('a body declaring no parameter is handed to computed, and a keyed one stays memo — 38.223', () => {
    const text = `import { memo, reactive } from '@abide/abide'

const seats = reactive(5)
export const total = memo(() => seats() * 40)
export const loaded = memo(async (): Promise<number> => 1)
export const named = memo(function () { return 1 })
export const streamed = memo(async function* () { yield 1 })
export const byId = memo(({ id }: { id: string }) => id)
`
    expect(toComputed(text, 'src/lib/totals.ts'))
        .toBe(`import { computed, memo, reactive } from '@abide/abide'

const seats = reactive(5)
export const total = computed(() => seats() * 40)
export const loaded = computed(async (): Promise<number> => 1)
export const named = computed(function () { return 1 })
export const streamed = computed(async function* () { yield 1 })
export const byId = memo(({ id }: { id: string }) => id)
`)
})

// 38.224 — A HANDLER CALL A PAGE HOLDS AS A VALUE IS HELD THROUGH `computed`: a declaration whose whole
// initializer calls a `.handler.ts` default or abide's `health`, and nothing else — an awaited call,
// one inside an event handler, and a call of anything else stay. THE REVERT: drop the "whole
// initializer" test from `wrapCalls`; `const amount = getDeal({ id }).amount` is wrapped too.
test('a handler call a page holds is wrapped in computed — 38.224', () => {
    const page = `<script>
import { health, reactive } from '@abide/abide'
import getDeal from './getDeal.handler.ts'
import { format } from './format.ts'

let id = reactive('d2')
const deal = getDeal({ id })
const account = health()
const label = format(id)
const amount = getDeal({ id }).amount
async function reload() {
    const fresh = await getDeal({ id })
    return fresh
}
</script>

<p>{deal.name}</p>`
    expect(toComputedCall(page, 'src/deals/index.abide')).toBe(`<script>
import { computed, health, reactive } from '@abide/abide'
import getDeal from './getDeal.handler.ts'
import { format } from './format.ts'

let id = reactive('d2')
const deal = computed(() => getDeal({ id }))
const account = computed(() => health())
const label = format(id)
const amount = getDeal({ id }).amount
async function reload() {
    const fresh = await getDeal({ id })
    return fresh
}
</script>

<p>{deal.name}</p>`)
    expect(toComputedCall('const deal = getDeal()', 'src/lib/deal.ts')).toBe(
        'const deal = getDeal()',
    )
})

// 38.225 — `fetchData` IS `fetchAndHandle` where abide's is imported, at the import and each use, and a
// member of that name is left. THE REVERT: rename a member too; `client.fetchData()` is renamed.
test('abide upgrade renames fetchData to fetchAndHandle — 38.225', () => {
    const text = `import { fetchData, GET } from '@abide/abide/server'

export default GET(() => fetchData('https://registry.example/a'))
const read = client.fetchData()
`
    expect(toFetchAndHandle(text, 'src/a.handler.ts'))
        .toBe(`import { fetchAndHandle, GET } from '@abide/abide/server'

export default GET(() => fetchAndHandle('https://registry.example/a'))
const read = client.fetchData()
`)
    const own = 'const fetchData = () => 1\nfetchData()'
    expect(toFetchAndHandle(own, 'src/own.ts')).toBe(own)
})

// 38.225 — WHERE THE ANSWER IS A NAME A FILE HANDS `isFailed`, the call catches its own `FetchFailed`
// back into the answer, as `fetchData` resolved with it, and the check still fires. THE REVERT: drop
// the `CAUGHT` edit in `toFetchAndHandle`; the call is renamed alone and the check never fires.
test('abide upgrade keeps an isFailed check on a fetchData answer firing — 38.225', () => {
    const text = `import { fetchData, isFailed } from '@abide/abide/server'

export async function rates(): Promise<number | null> {
    const answer = await fetchData<{ rate: number }>('https://rates.example')
    if (isFailed(answer)) return null
    return answer.rate
}
`
    expect(toFetchAndHandle(text, 'src/rates.server.ts'))
        .toBe(`import { fetchAndHandle, isFailed } from '@abide/abide/server'

export async function rates(): Promise<number | null> {
    const answer = await fetchAndHandle<{ rate: number }>('https://rates.example').catch((failed) => fetchAndHandle.isError(failed, 'FetchFailed') ? failed : Promise.reject(failed))
    if (isFailed(answer)) return null
    return answer.rate
}
`)
})

// 38.226 — WHAT A MIGRATION CANNOT REWRITE IS NAMED AT ITS LINE in the file it left: a `ttl` the call no
// longer takes, and a call in a file that checks a failure whose answer it cannot follow. A file it
// rewrote whole, run again, is changed and noted no more (38.200). THE REVERT: drop the `noted` pushes in
// `toFetchAndHandle`; no line is named and both calls are renamed silently.
test('abide upgrade names each fetchData call it cannot rewrite, at its line — 38.225, 38.226', async () => {
    const app = temporaryModule({
        'src/quote.server.ts': `import { fetchData, isFailed } from '@abide/abide/server'

export const cached = () => fetchData('https://quotes.example', { ttl: 60_000 })

export async function quote(): Promise<string> {
    const answer: unknown = await fetchData('https://quotes.example')
    return isFailed(answer) ? 'none' : String(answer)
}
`,
    })
    const notes: string[] = []
    const edits = await upgrade(app, '0.143.0', (note) =>
        notes.push(`${note.path}:${note.line} ${note.message.split(':')[0]}`),
    )
    expect(notes).toEqual([
        'src/quote.server.ts:3 fetchAndHandle keeps no answer, so ttl does nothing',
        'src/quote.server.ts:3 fetchAndHandle rejects with its FetchFailed where fetchData answered it',
        'src/quote.server.ts:6 fetchAndHandle rejects with its FetchFailed where fetchData answered it',
    ])
    for (const edit of edits) await Bun.write(`${app}/${edit.path}`, edit.after)
    const again: unknown[] = []
    expect(await upgrade(app, '0.143.0', (note) => again.push(note))).toEqual(
        [],
    )
    expect(again).toEqual([])
})

// 38.226 — THE NOTES ARE PRINTED AFTER THE DIFFS, each as its path and line. THE REVERT: drop the
// notes loop from `upgradeCommand` in bin/abide.ts; the diff prints and no line is named.
test('abide upgrade prints each note after its diffs — 38.226', async () => {
    const app = temporaryModule({
        'package.json': JSON.stringify({ name: 'quotes', type: 'module' }),
        'src/index.abide': '<main>quotes</main>',
        'src/quote.server.ts': `import { fetchData } from '@abide/abide/server'

export const cached = () => fetchData('https://quotes.example', { ttl: 60_000 })
`,
    })
    const upgraded = await abide(app, 'upgrade', '--from', '0.143.0')
    const noted = upgraded.stdout.indexOf(
        'src/quote.server.ts:3 — fetchAndHandle keeps no answer',
    )
    expect(noted).toBeGreaterThan(upgraded.stdout.indexOf('+++ '))
    expect(upgraded.exitCode).toBe(0)
}, 30_000)

// 38.227 — `poll` IS A `ttl` ON A MEMO AND A HANDLER: a number, and an `every` with no `delay`, move
// across with a note each; a `delay` scheduled a job, and is a note alone, as is every `reactive` and
// `computed` handed a source's option. Run again, nothing moves (38.200). THE REVERT: drop the
// `edits.push` in `toSourceOptions`; the polls stay polls and `ttl: 300_000` is not found.
test('abide upgrade moves poll to ttl and names what it cannot move — 38.227, 38.226', async () => {
    const app = temporaryModule({
        'src/ops.server.ts': `import { computed, memo, reactive } from '@abide/abide'
import { GET } from '@abide/abide/server'

export const followUps = memo(() => [], { global: true, poll: 300_000 })
export const scores = memo(() => [], { poll: { every: 3_600_000, after: 'settle' } })
export const digest = memo(() => [], { poll: { every: 60_000, delay: 5_000 } })
export const rates = GET(() => 1, { poll: 60_000 })
export const totals = computed(() => 1, { global: true })
export const query = reactive('', { debounce: 300 })
`,
    })
    const notes: string[] = []
    const edits = await upgrade(app, '0.143.0', (note) =>
        notes.push(`${note.line} ${note.message.split(':')[0]}`),
    )
    const after = edits.find((edit) => edit.path === 'src/ops.server.ts')?.after
    expect(after).toContain('memo(() => [], { global: true, ttl: 300_000 })')
    expect(after).toContain('memo(() => [], { ttl: 3_600_000 })')
    expect(after).toContain('{ poll: { every: 60_000, delay: 5_000 } }')
    expect(after).toContain('GET(() => 1, { ttl: 60_000 })')
    expect(notes).toEqual([
        '4 poll is now ttl',
        '5 poll is now ttl',
        '6 poll with a delay scheduled work whether or not anything read it, and poll is gone',
        '7 poll is now ttl',
        '8 reactive and reactive.derived take no ttl, throttle, debounce, tags, global or poll',
        '9 reactive and reactive.derived take no ttl, throttle, debounce, tags, global or poll',
    ])
    for (const edit of edits) await Bun.write(`${app}/${edit.path}`, edit.after)
    expect(await upgrade(app, '0.144.0')).toEqual([])
})
// 38.228 — `computed` IS `reactive.derived`: every use of abide's, `reactive` imported beside where it
// was not, and an app's own `computed` and a member of that name left. Run again, nothing moves
// (38.200). THE REVERT: drop the import edit in `toDerived`; `reactive` is never imported and the
// renamed calls name nothing.
test('abide upgrade spells computed reactive.derived — 38.228, 38.200', () => {
    const page = `<script>
import { computed, memo } from '@abide/abide'

const total = computed(() => 1)
const typed = computed<number>(() => 2)
const options = { computed: true }
const kept = options.computed
</script>

<p>{total}</p>`
    const after = toDerived(page, 'src/index.abide')
    expect(after).toBe(`<script>
import { memo, reactive } from '@abide/abide'

const total = reactive.derived(() => 1)
const typed = reactive.derived<number>(() => 2)
const options = { computed: true }
const kept = options.computed
</script>

<p>{total}</p>`)
    expect(toDerived(after, 'src/index.abide')).toBe(after)
    const own = `import { computed } from './lib/computed.ts'\n\nexport const x = computed(() => 1)\n`
    expect(toDerived(own, 'src/own.ts')).toBe(own)
})
