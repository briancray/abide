// 38.3 — `abide check`, ON THE `.abide` LINE. A page is checked as the program it runs as rather
// than as it was written, so a name read and written by name is not a type error, and every error
// that is one lands on the line and column the author typed. And the compiler's own warnings —
// 14.14 to 14.17 and 31.13 — each where the read is, and nowhere a near miss stands.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import type { Diagnosis } from '#compiler/TypeSession.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const CLEAN = `<script>
import { reactive } from 'abide'
import Card from '#ui/components/Card.abide'
import '#ui/app.css'

let count = reactive(0)
let thread = reactive<{ text: string } | undefined>(undefined)
</script>

<main>
<p>{thread ? thread.text : 'none'}</p>
<button onclick={(event) => { count = count + event.clientX }}>+</button>
<Card title="x"/>
</main>`

const BROKEN = `<script>
import { reactive } from 'abide'

let count = reactive(0)
const label: string = 5
</script>

<p>{count.toUpperCase()}</p>
<button onclick={() => { count = 'many' }}>set</button>
<i>{count(5)}</i>`

// EACH NAME IS ALSO A PIECE OF THE TEXT BEFORE IT IN ITS OWN SLOT OR TAG: the `f` in `#if`, the
// `e` in `:else`, the `or` in `for`, the `t` in `title`.
const ECHOED = `{#if f}<p title={t}>x</p>{:else if e}<i></i>{/if}
{#for r of or}<b>{r}</b>{/for}`

const WARNED = `<script>
import { reactive } from 'abide'

let flag = reactive(true)
let one = reactive(1)
let two = reactive(2)
let name = reactive('ada')
let maybe = reactive<string | undefined>(undefined)
let thing = reactive({ refresh: () => 1 })
let rows = reactive([{ id: 1 }])
let keyed = reactive(
    [{ id: 1 }],
    { by: 'id' },
)
let decoy = reactive([{ id: 1, by: 'someone' }])
const picked = reactive(() => (flag ? one : two))
const same = reactive(() => (flag ? flag : false))
const late = reactive(async () => {
    const early = two
    await Promise.resolve()
    return one + early
})
const later = reactive(() => {
    setTimeout(() => two, 0)
    return [1].map(() => one)
})
const fallback = reactive(() => name ?? 'nobody')
const unsure = reactive(() => maybe ?? 'nobody')
</script>

<button onclick={() => thing.refresh()}>go</button>
{#for row of rows}<input value={row.id}/>{/for}
{#for row of rows by row.id}<input value={row.id}/>{/for}
{#for label of ['a', 'b']}<input value={label}/>{/for}
{#for row of rows}<b>{row.id}</b>{/for}
{#for row of keyed}<input value={row.id}/>{/for}
{#for row of decoy}<input value={row.id}/>{/for}`

const CARD = `<script>
import { props } from 'abide'

const { title } = props<{ title: string }>()
</script>

<h2>{title}</h2>`

// 33.4 — every tag held to what its component declares. The first five are right; each after them
// is wrong in a different way.
const PROPS = `<script>
import { reactive } from 'abide'
import Card from '#ui/components/Card.abide'
import Bare from '#ui/components/Bare.abide'
import Held from '#ui/components/Held.abide'

let count = reactive(0)
let name = reactive('ada')
</script>

<Card title={name}/>
<Card {...{ title: 'x' }}/>
<Held bind:value={name}/>
<Held bind:value={{ get: () => name, set: (typed) => { name = typed.trim() } }}/>
<Bare/>
<Card title="x"><b>kids</b></Card>
<Card title={count}/>
<Card titel="x"/>
<Bare extra="x"/>
<Held value={name}/>
<Held bind:value={count}/>`

// 32.35 — a tag choosing by a value is held to the props of what it may hold, and may hold nothing.
const CHOSEN = `<script>
import { reactive } from 'abide'
import Card from '#ui/components/Card.abide'

let open = reactive(true)
let Shown = reactive(() => (open ? Card : undefined))
</script>

<Shown title="x"/>
<Shown title={1}/>`

// 33.6 — A PROP THE CHILD WRITES checks as its cell, read by name as its value. THE REVERT: type
// every key `__accessors` hands back as a plain accessor; `value.toUpperCase()` and the write are
// both reported against this file.
const HELD = `<script>
import { props } from 'abide'

const { value } = props<{ value: string }>()
</script>

<p>{value.toUpperCase()}</p>
<button onclick={() => (value = value + '!')}>more</button>`

// A WRITE NARROWS AS JAVASCRIPT'S DOES: after `x = 3` under `x === null`, `x` is a number.
const NARROWED = `<script>
import { reactive } from 'abide'

let x = reactive<number | null>(null)

function bump() {
    if (x === null) {
        x = 3
        return x.toFixed()
    }
    x += 1
    return x.toFixed()
}

function fill() {
    x ??= 4
    return x.toFixed()
}
</script>

<button onclick={bump}>bump</button>
<button onclick={fill}>fill</button>`

let app = ''
let found: Diagnosis[] = []

beforeAll(async () => {
    app = appFixture({
        'package.json': JSON.stringify({
            name: 'check-fixture',
            type: 'module',
            imports: {
                '#ui/*': './ui/*',
                '#shared/*': './shared/*',
            },
        }),
        'ui/pages/page.abide': CLEAN,
        'ui/pages/broken/page.abide': BROKEN,
        'ui/pages/warned/page.abide': WARNED,
        'ui/pages/echoed/page.abide': ECHOED,
        'ui/components/Card.abide': CARD,
        'ui/pages/props/page.abide': PROPS,
        'ui/pages/chosen/page.abide': CHOSEN,
        'ui/pages/narrowed/page.abide': NARROWED,
        'ui/components/Bare.abide': '<p>bare</p>',
        'ui/components/Held.abide': HELD,
        'ui/app.css': 'p { color: red }',
        'shared/sum.ts': "export const sum: number = 'x'\n",
    })
    found = await checkApp(app)
}, 60_000)

afterAll(removeTemporaryModules)

// Where `needle` starts in `text`, as a line and a column from 1 — `skip` characters into it.
function place(
    text: string,
    needle: string,
    skip = 0,
): { line: number; column: number } {
    const at = text.indexOf(needle) + skip
    const before = text.slice(0, at)
    const line = before.split('\n').length
    return { line, column: at - before.lastIndexOf('\n') }
}

function inFile(ending: string): Diagnosis[] {
    return found.filter((diagnosis) => diagnosis.path.endsWith(ending))
}

// THE REVERT: hand `diagnose` the projection's own text in place of `checkedShadow`'s; the clean
// page reports `count + event.clientX` as an operator on a `Reactive` (TS2365), `thread.text` as a
// member of one, and the component import as a module that does not exist.
test('a page read and written by name checks clean — 38.3', () => {
    expect(inFile('ui/pages/page.abide')).toEqual([])
    expect(inFile('Card.abide')).toEqual([])
})

// THE REVERT: project a component's attributes as statements of their own (`__any(value)`), as
// before a tag was a call; nothing is reported here at all. Or type every checked module's default
// export as taking `any` (`componentModule('any')`); the same.
test('a tag is held to the props its component declares, on the attribute — 38.41', () => {
    const at = (needle: string, skip: number) => place(PROPS, needle, skip)
    const reported: { line: number; column: number; code: number }[] = []
    for (const { line, column, code } of inFile('props/page.abide'))
        reported.push({ line, column, code })
    expect(reported).toEqual([
        // Nothing on the `{ get, set }` pair: `set`'s parameter is typed by what `get` answers
        // (32.6), and no 14.16 warning on either member (14.18). THE REVERTS: drop `__bound`'s
        // pair overload, or the `__bound` arm of `runsSynchronously`; a finding lands on its line.
        // A value of the wrong type — a name read by name is its value (31.1).
        { ...at('<Card title={count}', 13), code: 2322 },
        // A prop the component does not declare.
        { ...at('<Card titel', 6), code: 2353 },
        // 33.2 — a component with no `props` call takes none.
        { ...at('<Bare extra', 6), code: 2322 },
        // 32.6 — a `bind:` is held to the prop as the value its `Reactive` holds.
        { ...at('<Held bind:value={count}', 18), code: 2322 },
    ])
    expect(inFile('Bare.abide')).toEqual([])
    expect(inFile('Held.abide')).toEqual([])
})

// THE REVERT: drop the tag spans from `checkedShadow`'s units; the tag is checked as a call on the
// `Reactive` itself, and both tags report its arity (TS2554) in place of the one wrong prop.
test('a tag choosing by a value is held to the props of what it holds — 32.35, 38.41', () => {
    const reported: { line: number; column: number; code: number }[] = []
    for (const { line, column, code } of inFile('chosen/page.abide'))
        reported.push({ line, column, code })
    expect(reported).toEqual([
        { ...place(CHOSEN, '<Shown title={1}', 14), code: 2322 },
    ])
})

// THE LINE IS THE POINT: each error at the line and column of what was typed. THE REVERT: map
// through the checked text alone, skipping the projection's origins; every line reads as an offset
// into the shadow, past the end of the file.
test('an error in a script, a slot or a write lands on its own line — 38.3', () => {
    const errors = inFile('broken/page.abide')
    const at = (code: number) =>
        errors
            .filter((diagnosis) => diagnosis.code === code)
            .map(({ line, column }) => ({ line, column }))
    expect(at(2322)).toEqual([place(BROKEN, 'label: string')])
    expect(at(2339)).toEqual([place(BROKEN, 'toUpperCase')])
    // The value of a write, where it was written — not the start of the write.
    expect(at(2345)).toEqual([place(BROKEN, "'many'")])
})

// A PIECE IS PLACED WHERE IT WAS SLICED, not where its text is next found. THE REVERT: place each
// with `source.indexOf(text, at)` from the start of its slot or tag; every one of the four lands on
// the earlier echo — the keyword or the attribute's name — rather than on what was typed.
test('an error lands on the name, not on an earlier echo of it — 38.3', () => {
    expect(
        inFile('echoed/page.abide')
            .filter((diagnosis) => diagnosis.code === 2304)
            .map(({ line, column }) => ({ line, column })),
    ).toEqual([
        place(ECHOED, 'f}'),
        place(ECHOED, 't}'),
        place(ECHOED, 'e}'),
        place(ECHOED, 'or}'),
    ])
})

// 38.3 — A WRITE UNDOES A NARROWING, as the program it runs as does. THE REVERT: return `undefined`
// from `checkedWriteParts`, so a write is `x.set(3)` — a call, which undoes nothing — and each
// `x.toFixed()` after one reports `x` as possibly null (TS18047).
test('a write narrows the name it writes — 38.3', () => {
    expect(inFile('narrowed/page.abide')).toEqual([])
})

// 31.11 — A BUILD REFUSAL, REPORTED AS A FINDING, and the rest of the file still checked around
// it. THE REVERT: throw in `Lowering` whatever the mode; the check ends at this page with nothing
// said about its other lines.
test('a read given an argument is a finding at the read — 31.11', () => {
    const refused = inFile('broken/page.abide').filter(
        (diagnosis) => diagnosis.code === 0,
    )
    expect(refused.length).toBe(1)
    expect(refused[0]?.message).toContain('RULEBOOK 31.11')
    expect(refused[0]).toMatchObject(place(BROKEN, 'count(5)'))
})

// AND ONCE, across the app. THE REVERT: hand `emitApp` every readable file, and its own lowering
// throws the same 31.11 at the app root — two findings, and the app-wide ones after it never said.
test('a read given an argument is reported once for the whole app — 31.11', () => {
    expect(
        found.filter((diagnosis) =>
            diagnosis.message.includes('RULEBOOK 31.11'),
        ).length,
    ).toBe(1)
})

test('a .ts file beside the pages is checked as it stands — 38.3', () => {
    expect(
        inFile('shared/sum.ts').map(({ line, column, code }) => ({
            line,
            column,
            code,
        })),
    ).toEqual([{ line: 1, column: 14, code: 2322 }])
})

// EACH WARNING AT ITS READ, AND NOT AT THE NEAR MISS BESIDE IT: `early` read before the `await`,
// `one` read inside a `map` that runs before the body returns, `flag` deciding between itself, and
// `maybe` whose type admits the fallback.
//
// THE REVERTS, one per clause: drop the `awaitsIn` loop and `one` after the `await` goes unwarned
// (0 against 1); treat every created function as deferred and `[1].map(() => one)` warns (2 against
// 1); drop `read.name !== name` from `decidesARead` and `same` warns (2 against 1); drop
// `admitsNullish` and `maybe ?? …` warns (2 against 1); drop the property scan and `thing.refresh`
// goes unwarned (0 against 1).
test('each tracking warning lands on its read and on no near miss — 14.14, 14.15, 14.16, 14.17, 31.13', () => {
    const warnings = inFile('warned/page.abide').filter(
        (diagnosis) => diagnosis.category === 'warning',
    )
    const by = (clause: string) =>
        warnings
            .filter((diagnosis) => diagnosis.message.includes(clause))
            .map(({ line, column }) => ({ line, column }))
    expect(by('14.14')).toEqual([place(WARNED, 'one + early')])
    expect(by('14.15')).toEqual([place(WARNED, 'flag ? one')])
    expect(by('14.16')).toEqual([place(WARNED, 'two, 0')])
    expect(by('14.17')).toEqual([place(WARNED, "name ?? 'nobody'")])
    expect(by('31.13')).toEqual([place(WARNED, 'thing.refresh')])
    expect(warnings.length).toBe(7)
})

// 32.14 — UNKEYED, OVER STATE, OVER A LIST THAT CAN CHANGE: the loops that are all three, less the one
// whose value declares `by` (32.33) — and not the decoy, whose ROWS carry a `by` and whose value does
// not. THE REVERT: drop `holdsState` from `templateWarnings`; the `<b>` loop warns too (3 against 2).
// Drop `canChange` and the constant list warns (3 against 2). Drop `keyedByValue` and `keyed` warns
// (3 against 2).
test('an unkeyed loop over a body holding state warns at its subject — 32.14', () => {
    const loops = inFile('warned/page.abide').filter((diagnosis) =>
        diagnosis.message.includes('32.14'),
    )
    expect(loops.map(({ line, column }) => ({ line, column }))).toEqual([
        place(WARNED, 'rows}<input'),
        place(WARNED, 'decoy}<input'),
    ])
})

// 32.33 — A VALUE DECLARED IN ANOTHER MODULE KEYS BY ITS `by` TOO, imported under its own name or
// another. THE REVERT: read `by` off the page's own setup text rather than the checker's
// declaration; both imported loops warn (3 against 1).
test('an unkeyed loop over an imported value that declares `by` does not warn — 32.33', async () => {
    const imported = appFixture({
        'ui/rows.ts': `import { reactive } from 'abide'
export const shared = reactive([{ id: 1 }], { by: 'id' })
export const plain = reactive([{ id: 1 }])
`,
        'ui/pages/page.abide': `<script>
import { plain, shared } from '#ui/rows.ts'
import { shared as renamed } from '#ui/rows.ts'
</script>
{#for row of shared}<input />{/for}
{#for row of renamed}<input />{/for}
{#for row of plain}<input />{/for}
`,
    })
    const loops = (await checkApp(imported)).filter((diagnosis) =>
        diagnosis.message.includes('32.14'),
    )
    expect(loops.map(({ line }) => line)).toEqual([7])
}, 60_000)

// A REFUSAL ONLY THE WHOLE APP CAN SEE is a finding too: a module under `server/rpc` exporting what
// no handler declares type-checks, and only the emit refuses it. THE REVERT: skip `emitApp` in
// `checkApp`; the check reads 0 refusals where 1 is due.
test('a check reports what only building the whole app refuses — 19.16', async () => {
    const stray = appFixture({
        'ui/pages/page.abide': '<p>hello</p>',
        'server/rpc/things.ts': 'export const answer = 42\n',
    })
    const refused = (await checkApp(stray)).filter((diagnosis) =>
        diagnosis.message.includes('19.16'),
    )
    expect(refused.length).toBe(1)
}, 60_000)

// 32.6 — A `bind:` WITH NOTHING BOUND IS NO PROP, to the checker as to the build: both key a tag's
// props by `propKeyOf`. THE REVERT: key a `bind:` whatever it holds in `projectShadow`; the checker
// then holds `""` to `Reactive<string>` (TS2322) beside the build's refusal, two answers to one tag.
test('a bind: with nothing bound is refused, and is no prop to the checker — 32.6', async () => {
    const unbound = appFixture({
        'package.json': JSON.stringify({
            name: 'unbound-fixture',
            type: 'module',
            imports: { '#ui/*': './ui/*' },
        }),
        'ui/pages/page.abide': `<script>
import Held from '#ui/components/Held.abide'
</script>
<Held bind:value/>`,
        'ui/components/Held.abide': HELD,
    })
    const codes: number[] = []
    for (const diagnosis of await checkApp(unbound)) codes.push(diagnosis.code)
    // The build's refusal, and the prop the tag never passed.
    expect(codes).toEqual([0, 2741])
}, 60_000)

// THE SAME WARNINGS FROM THE BUILD, which is what `abide build` and `abide dev` print. THE REVERT:
// hand back `[]` for `warnings` in `compileApp`; this reads 0 where 7 are due.
test('a compile carries the warnings a check reports — 14.14, 32.14', async () => {
    const warnedOnly = appFixture({ 'ui/pages/page.abide': WARNED })
    const compiled = await compileApp(warnedOnly)
    expect(compiled.warnings.length).toBe(7)
    expect(compiled.warnings[0]?.path).toEndWith('ui/pages/page.abide')
}, 60_000)

// A FAILURE WHERE ANY FINDING IS AN ERROR, and a success where they are warnings alone — which is
// what `abide check && abide build` in CI rests on. THE REVERT: return 0 from `check` whatever it
// found; the first spawn exits 0 over four errors.
test('abide check fails on an error and passes on warnings alone — 38.3', () => {
    const all = Bun.spawnSync(['bun', BIN, 'check', '--root', app], {
        cwd: app,
    })
    expect(all.exitCode).toBe(1)
    const said = all.stdout.toString()
    expect(said).toContain(
        `ui/pages/broken/page.abide:${place(BROKEN, 'toUpperCase').line}:`,
    )
    const warned = Bun.spawnSync(
        ['bun', BIN, 'check', '--root', app, 'ui/pages/warned'],
        { cwd: app },
    )
    expect(warned.exitCode).toBe(0)
    expect(warned.stdout.toString()).toContain('0 errors, 7 warnings')
}, 60_000)
