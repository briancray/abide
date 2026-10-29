// 38.3 — `abide check`, ON THE `.abide` LINE. A page is checked as the program it runs as rather
// than as it was written, so a name read and written by name is not a type error, and every error
// that is one lands on the line and column the author typed. And the compiler's own warnings —
// 14.14 to 14.17 and 31.13 — each where the read is, and nowhere a near miss stands.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { realpathSync } from 'node:fs' // bun exposes no realpath of its own
import { relative } from 'node:path' // bun exposes no path helpers of its own
import { spawned } from '@abide/harness/gate'
import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import type { Diagnosis } from '#compiler/TypeSession.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const TYPO = `<script>
import { props } from '@abide/abide'

const { heading } = props<{ heading: Strin }>()
</script>

<p>{heading}</p>`

const CLEAN = `<script>
import { reactive } from '@abide/abide'
import Card from '#src/lib/Card.abide'
import '#src/lib/app.css'

let count = reactive(0)
let thread = reactive<{ text: string } | undefined>(undefined)
</script>

<main>
<p>{thread ? thread.text : 'none'}</p>
<button onclick={(event) => { count = count + event.clientX }}>+</button>
<Card title="x"/>
</main>`

const BROKEN = `<script>
import { reactive } from '@abide/abide'

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

const ROUTED = `<script>
import { route } from '@abide/abide'

const id: string = route.params().id
const rest: string[] = route.params().rest
const wrong: number = route.params().id
const named: string = route.params.id
const listed: boolean = route.name.startsWith('/routed') && !route.navigating
</script>

<p>{id} {rest.join('/')} {wrong} {named} {listed} {route.url.pathname}</p>`

const LINKED = `<script>
import { url } from '@abide/abide'

const good = url('/routed/[id]/[...rest]', { id: 1, rest: ['s', 2] })
const home = url('/')
const stale = url('/routed/[id]', { id: 1 })
const face = url('/fonts/face.woff2')
const tools = url('/__abide/mcp')
const client = url('/__abide/client')
</script>

<a href={good}>{home}</a><a href={stale}>stale</a><a href={face}>face</a><a href={tools}>{client}</a>`

// 34.18 — a plain `let` the setup writes, beside one only a handler writes and one that is a
// `reactive`: the first is the leak, and the other two are not.
const SHARED = `<script module>
import { reactive } from '@abide/abide'

let opened = 0
let clicks = 0
let counted = reactive(0)
</script>

<script>
opened += 1
counted += 1
const seat = opened
function bump() { clicks += 1 }
</script>

<span onclick={bump}>row {seat} {counted}</span>
`

const WARNED = `<script>
import { reactive } from '@abide/abide'

let flag = reactive(true)
let one = reactive(1)
let two = reactive(2)
let name = reactive('ada')
let maybe = reactive<string | undefined>(undefined)
let thing = reactive({ refresh: () => 1 })
let optional = reactive<{ refresh: () => number } | undefined>(undefined)
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
<button onclick={() => optional?.refresh()}>go</button>
{#for row of rows}<input value={row.id}/>{/for}
{#for row of rows by row.id}<input value={row.id}/>{/for}
{#for label of ['a', 'b']}<input value={label}/>{/for}
{#for row of rows}<b>{row.id}</b>{/for}
{#for row of keyed}<input value={row.id}/>{/for}
{#for row of decoy}<input value={row.id}/>{/for}`

// 14.19 — each read below would be warned on, and the line above it silences the clause it names.
// `misnamed` is the near miss: its directive names 14.14, and the warning it earns is 14.16.
const IGNORED = `<script>
import { reactive } from '@abide/abide'

let flag = reactive(true)
let one = reactive(1)
let two = reactive(2)
const late = reactive(async () => {
    await Promise.resolve()
    // abide-ignore 14.14
    return one
})
const picked = reactive(() =>
    // abide-ignore 14.14 14.15
    flag ? one : two,
)
const misnamed = reactive(() => {
    // abide-ignore 14.14
    setTimeout(() => two, 0)
    return 1
})
</script>

<p>{late} {picked} {misnamed}</p>`

const CARD = `<script>
import { props } from '@abide/abide'

const { title } = props<{ title: string }>()
</script>

<h2>{title}</h2>`

// 33.4 — every tag held to what its component declares. The first five are right; each after them
// is wrong in a different way.
const PROPS = `<script>
import { reactive } from '@abide/abide'
import Card from '#src/lib/Card.abide'
import Bare from '#src/lib/Bare.abide'
import Held from '#src/lib/Held.abide'

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

// 32.34 — a tag choosing by a value is held to the props of what it may hold, and may hold nothing.
const CHOSEN = `<script>
import { reactive } from '@abide/abide'
import Card from '#src/lib/Card.abide'

let open = reactive(true)
let Shown = reactive(() => (open ? Card : undefined))
</script>

<Shown title="x"/>
<Shown title={1}/>`

// 33.6 — A PROP THE CHILD WRITES checks as its cell, read by name as its value. THE REVERT: type
// every key `__accessors` hands back as a plain accessor; `value.toUpperCase()` and the write are
// both reported against this file.
const HELD = `<script>
import { props } from '@abide/abide'

const { value } = props<{ value: string }>()
</script>

<p>{value.toUpperCase()}</p>
<button onclick={() => (value = value + '!')}>more</button>`

// 33.4 — AN OPTIONAL PROP IS STILL ONE ACCESSOR: the key is optional to the caller, never the
// accessor to the child. THE REVERT: drop the `-?` on `__accessors`; the read reports TS2344.
const OPTIONAL = `<script>
import { props } from '@abide/abide'

const { label } = props<{ label?: string }>()
</script>

<p>{label ?? 'none'}</p>`

// 38.3 — A WRITE ON THE LINE AFTER ONE WITH NO SEMICOLON. The checker's write opens on `(` where
// it is a value, and JavaScript reads a line opening on `(` as a call on the line above. THE REVERT:
// open every checked write on `(`; this reports TS2349, `Promise<void>` not callable.
const AFTER_AWAIT = `<script>
import { reactive } from '@abide/abide'

let copied = reactive('')

async function copy() {
    await Promise.resolve()
    copied = 'yes'
}
</script>

<button onclick={copy}>{copied}</button>`

// A WRITE NARROWS AS JAVASCRIPT'S DOES: after `x = 3` under `x === null`, `x` is a number.
const NARROWED = `<script>
import { reactive } from '@abide/abide'

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

// 27.13 — what `onConfig`'s defaults return is what `config()` hands back, in the file that files
// them and in one that only reads. `middleware` is declared beside `onConfig` and declares nothing.
const CONFIGURED = `<script server>
import { config, middleware, onConfig } from '@abide/abide/server'

onConfig(() => ({ RETRIES: 3, LABEL: 'x' }))
middleware((next) => next())

const retries: number = config().RETRIES
const wrong: string = config().RETRIES
</script>`

let app = ''
let found: Diagnosis[] = []

beforeAll(async () => {
    app = appFixture({
        'index.abide': CLEAN,
        'broken/index.abide': BROKEN,
        'warned/index.abide': WARNED,
        'ignored/index.abide': IGNORED,
        'shared/index.abide': SHARED,
        'echoed/index.abide': ECHOED,
        'lib/Card.abide': CARD,
        'props/index.abide': PROPS,
        'chosen/index.abide': CHOSEN,
        'narrowed/index.abide': NARROWED,
        'after-await/index.abide': AFTER_AWAIT,
        'lib/Bare.abide': '<p>bare</p>',
        'lib/Held.abide': HELD,
        'lib/Optional.abide': OPTIONAL,
        'routed/[id]/[...rest]/index.abide': ROUTED,
        'linked/index.abide': LINKED,
        'public/fonts/face.woff2': 'a face',
        'configured/index.abide': CONFIGURED,
        'configured/elsewhere/index.abide': `<script server>
import { config } from '@abide/abide/server'

const label: string = config().LABEL
</script>`,
        'routed/layout.abide': `<script>
import { route } from '@abide/abide'

const section: string | string[] | undefined = route.params().section
</script>
<slot/>`,
        'lib/Typo.abide': TYPO,
        'lib/Defaulted.abide': `<script>
import { props } from '@abide/abide'

const { start = 0 } = props<{ start?: number }>()
</script>

<p>{start.toFixed(1)}</p>`,
        'lib/app.css': 'p { color: red }',
        'lib/notes.md': '# notes\n',
        'lib/notes.ts':
            "import notes from '#src/lib/notes.md' with { type: 'text' }\n\nexport const length: number = notes.length\n",
        'lib/sum.ts': "export const sum: number = 'x'\n",
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

// The findings in the file at `below`, its path below the fixture's root.
function inFile(below: string): Diagnosis[] {
    return found.filter(
        (diagnosis) => relative(realpathSync(app), diagnosis.path) === below,
    )
}

// THE REVERT: hand `diagnose` the projection's own text in place of `checkedShadow`'s; the clean
// page reports `count + event.clientX` as an operator on a `Reactive` (TS2365), `thread.text` as a
// member of one, and the component import as a module that does not exist.
test('a page read and written by name checks clean — 38.3', () => {
    expect(inFile('index.abide')).toEqual([])
    expect(inFile('lib/Card.abide')).toEqual([])
})

// THE REVERT: project a component's attributes as statements of their own (`__any(value)`), as
// before a tag was a call; nothing is reported here at all. Or type every checked module's default
// export as taking `any` (`componentModule('any')`); the same.
test('an optional prop reads as its value or undefined — 33.4', () => {
    expect(inFile('lib/Optional.abide')).toEqual([])
})

test('a tag is held to the props its component declares, on the attribute — 38.40', () => {
    const at = (needle: string, skip: number) => place(PROPS, needle, skip)
    const reported: { line: number; column: number; code: number }[] = []
    for (const { line, column, code } of inFile('props/index.abide'))
        reported.push({ line, column, code })
    expect(reported).toEqual([
        // Nothing on the `{ get, set }` pair: `set`'s parameter is typed by what `get` answers
        // (32.6), and no 14.16 warning on either member (14.18). THE REVERTS: drop `__bound`'s
        // pair overload, or the `componentBind` arm of `runsSynchronously`; a finding lands on its line.
        // A value of the wrong type — a name read by name is its value (31.1).
        { ...at('<Card title={count}', 13), code: 2322 },
        // A prop the component does not declare — keyed by the attribute's own name (38.116), so
        // the checker offers the prop it is a misspelling of (TS2561 rather than TS2353).
        { ...at('<Card titel', 6), code: 2561 },
        // 33.2 — a component with no `props` call takes none.
        { ...at('<Bare extra', 6), code: 2322 },
        // 32.6 — a `bind:` is held to the prop as the value its `Reactive` holds.
        { ...at('<Held bind:value={count}', 18), code: 2322 },
    ])
    expect(inFile('lib/Bare.abide')).toEqual([])
    expect(inFile('lib/Held.abide')).toEqual([])
})

// THE REVERT: drop the tag spans from `checkedShadow`'s units; the tag is checked as a call on the
// `Reactive` itself, and both tags report its arity (TS2554) in place of the one wrong prop.
test('a tag choosing by a value is held to the props of what it holds — 32.34, 38.40', () => {
    const reported: { line: number; column: number; code: number }[] = []
    for (const { line, column, code } of inFile('chosen/index.abide'))
        reported.push({ line, column, code })
    expect(reported).toEqual([
        { ...place(CHOSEN, '<Shown title={1}', 14), code: 2322 },
    ])
})

// THE LINE IS THE POINT: each error at the line and column of what was typed. THE REVERT: map
// through the checked text alone, skipping the projection's origins; every line reads as an offset
// into the shadow, past the end of the file.
test('an error in a script, a slot or a write lands on its own line — 38.3', () => {
    const errors = inFile('broken/index.abide')
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
        inFile('echoed/index.abide')
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
test('a write after a line with no semicolon checks as its own statement — 38.3', () => {
    expect(inFile('after-await/index.abide')).toEqual([])
})

// THE REVERT: drop `*.md` from `AMBIENT_DECLARATIONS`; the import is a module that does not exist
// (TS2307). A `.abide` types it without the declaration, so the import is in a `.ts`.
test('markdown imported as text is a string in a .ts — 34.21', () => {
    expect(inFile('lib/notes.ts')).toEqual([])
})

// 23.9 — A PAGE READS WHAT ITS OWN ROUTE PROMISES: `id` is text, a rest is a list, and nothing else
// is there. THE REVERT: drop the `routeParams` a read of it carries; `params` is the shared
// `Record<string, string | string[]>`, and `id` and `rest` are refused (TS2322) as well as `wrong`,
// three findings where the one is due.
test('route.params in a page is typed by its own route — 23.9', () => {
    expect(
        inFile('routed/[id]/[...rest]/index.abide').map(
            ({ line, column, code }) => ({ line, column, code }),
        ),
    ).toEqual([{ ...place(ROUTED, 'wrong'), code: 2322 }])
    expect(inFile('routed/layout.abide')).toEqual([])
})

// 30.26 — A LINK NAMES A PAGE OR A PUBLIC FILE THE APP HAS. `/routed/[id]` is the stale literal a
// page left behind when its route grew a rest segment, and it built an address the server answers
// from another page. THE REVERTS: drop the `Routes` declaration `diagnose` registers; `url` takes
// any literal and the stale one goes unreported, 0 findings where 1 is due. Or drop the public files
// from `routesDeclaration`; `/fonts/face.woff2` is refused too, 3 where 2 are due. Or drop
// `FRAMEWORK_ROUTES`; `/__abide/mcp` is refused too, 3 where 2 are due. `/__abide/client` is no
// address an app fetches, and stays refused.
test('url refuses a literal no page, public file or framework address is at — 30.26', () => {
    expect(
        inFile('linked/index.abide').map(({ line, column, code }) => ({
            line,
            column,
            code,
        })),
    ).toEqual([
        { ...place(LINKED, "'/routed/[id]'"), code: 2345 },
        { ...place(LINKED, "'/__abide/client'"), code: 2345 },
    ])
})

// 27.13 — `Config` IS WIDENED BY WHAT `onConfig`'S DEFAULTS RETURN, with no declaration written.
// THE REVERTS: have `configDeclarations` augment an interface other than `Config`; every field reads
// `unknown`, and the page reports 2 findings where 1 is due. Or drop the name test from
// `configReads`; `middleware` is captured as defaults, and the page reports 3.
test('config() is typed by what onConfig defaults — 27.13', () => {
    expect(
        inFile('configured/index.abide').map(({ line, column, code }) => ({
            line,
            column,
            code,
        })),
    ).toEqual([{ ...place(CONFIGURED, 'wrong'), code: 2322 }])
    expect(inFile('configured/elsewhere/index.abide')).toEqual([])
})

// 38.3 — A FINDING IN A COMPONENT'S PROPS TYPE IS REPORTED ONCE, where it was typed, though the
// checked module reads that type twice (its `props` call, and what a tag is held to). THE REVERT:
// drop the de-duplication from `TypeSession.diagnose`; it reads twice.
test("a finding in a component's props type is reported once — 38.3", () => {
    expect(
        inFile('lib/Typo.abide').map(({ line, column, code }) => ({
            line,
            column,
            code,
        })),
    ).toEqual([{ ...place(TYPO, 'Strin'), code: 2552 }])
})

// 33.20 — A DEFAULTED PROP IS NEVER UNDEFINED, so its binding is typed without it. THE REVERT: hand
// `__accessors` no `defaulted` keys; `start.toFixed` reports `start` as possibly undefined (TS18048).
test('a defaulted prop is typed without undefined — 33.20', () => {
    expect(inFile('lib/Defaulted.abide')).toEqual([])
})

test('a write narrows the name it writes — 38.3', () => {
    expect(inFile('narrowed/index.abide')).toEqual([])
})

// 31.11 — A BUILD REFUSAL, REPORTED AS A FINDING, and the rest of the file still checked around
// it. THE REVERT: throw in `Lowering` whatever the mode; the check ends at this page with nothing
// said about its other lines.
test('a read given an argument is a finding at the read — 31.11', () => {
    const refused = inFile('broken/index.abide').filter(
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
        inFile('lib/sum.ts').map(({ line, column, code }) => ({
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
// goes unwarned (0 against 1); scan the union whole rather than per member and `optional?.refresh`
// goes unwarned (1 against 2), because `undefined` shares no property with anything.
test('each tracking warning lands on its read and on no near miss — 14.14, 14.15, 14.16, 14.17, 31.13', () => {
    const warnings = inFile('warned/index.abide').filter(
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
    expect(by('31.13')).toEqual([
        place(WARNED, 'thing.refresh'),
        place(WARNED, 'optional?.refresh'),
    ])
    expect(warnings.length).toBe(8)
})

// THE REVERT: drop the `isIgnored` test from `TypeSession.readsFor`; the two silenced reads are
// warned on (3 against 1).
test('a warning the line above its read names the clause of is not reported — 14.19', () => {
    const warnings = inFile('ignored/index.abide').filter(
        (diagnosis) => diagnosis.category === 'warning',
    )
    expect(warnings.map(({ message }) => message.slice(-15))).toEqual([
        'RULEBOOK 14.16.',
    ])
    expect(warnings[0]).toMatchObject(place(IGNORED, 'two, 0'))
})

// THE REVERT: drop the `sharedModuleWrites` call in `readsIn`; nothing lands (0 against 1). Drop
// `insideFunction` and the handler's `clicks += 1` warns too (2 against 1); drop the `reactive`
// test and `counted += 1` does (2 against 1).
test('a plain let the setup writes in a script module is warned on — 34.18', () => {
    const warned = inFile('shared/index.abide')
        .filter((diagnosis) => diagnosis.message.includes('34.18'))
        .map(({ line, column }) => ({ line, column }))
    expect(warned).toEqual([place(SHARED, 'opened += 1')])
})

// 32.14 — UNKEYED, OVER STATE, OVER A LIST THAT CAN CHANGE: the loops that are all three, less the one
// whose value declares `by` (32.32) — and not the decoy, whose ROWS carry a `by` and whose value does
// not. THE REVERT: drop `holdsState` from `templateWarnings`; the `<b>` loop warns too (3 against 2).
// Drop `canChange` and the constant list warns (3 against 2). Drop `keyedByValue` and `keyed` warns
// (3 against 2).
test('an unkeyed loop over a body holding state warns at its subject — 32.14', () => {
    const loops = inFile('warned/index.abide').filter((diagnosis) =>
        diagnosis.message.includes('32.14'),
    )
    expect(loops.map(({ line, column }) => ({ line, column }))).toEqual([
        place(WARNED, 'rows}<input'),
        place(WARNED, 'decoy}<input'),
    ])
})

// 33.11 — AN INDEX SIGNATURE BESIDE TYPED PROPS LEAVES THEM TYPED. `size` indexes a record by its
// declared keys and `onclick` is a declared function, under `strict` and `noUncheckedIndexedAccess`
// as an app's own project sets them. THE REVERT: map `__accessors` over `Exclude<keyof Record, …>`
// again; over an index signature that is `string | number`, the named keys go, and `size` and
// `color` are indexes the records refuse (TS7053, 4) and accessors that may be `undefined` (TS2344).
test('an index signature beside typed props leaves them typed — 33.11', async () => {
    const indexed = appFixture({
        'tsconfig.json': JSON.stringify({
            compilerOptions: {
                strict: true,
                target: 'esnext',
                module: 'preserve',
                moduleResolution: 'bundler',
                allowImportingTsExtensions: true,
                noEmit: true,
                skipLibCheck: true,
                noUncheckedIndexedAccess: true,
            },
            include: ['.'],
        }),
        'lib/Button.abide': `<script>
import { props } from '@abide/abide'

const SIZES = { sm: 'p-1', md: 'p-2' }
const COLORS = { stone: 'bg-stone-700', lime: 'bg-lime-700' }

const { size, color, ...attributes } = props<{
    size?: keyof typeof SIZES
    color?: keyof typeof COLORS
    onclick?: (event: MouseEvent) => void
    [attribute: string]: unknown
}>()
</script>

{#if attributes.href}
    <a class="{color ? COLORS[color] : ''} {size ? SIZES[size] : ''}" {...attributes}><slot/></a>
{:else}
    <button class="{color ? COLORS[color] : ''} {size ? SIZES[size] : ''}" {...attributes}><slot/></button>
{/if}`,
        'index.abide': `<script>
import Button from '#src/lib/Button.abide'
</script>
<Button size="sm" color="lime" onclick={(event) => console.log(event.clientX)}>go</Button>`,
    })
    expect(await checkApp(indexed)).toEqual([])
}, 60_000)

// 4.15 WITHOUT `strictNullChecks`, as an app ported from untyped code may run. `undefined` is then
// assignable to a body, so the value opening at it has to be resolved ahead of every body. THE
// REVERT: drop the `initial: undefined` overload at the head of `reactive`'s; `reactive<Thing |
// undefined>(undefined)` is a stream of `Thing`, and `go` is a member `Thing[]` lacks (TS2339, 1).
test('a value opening at undefined is a value with strict off — 4.15', async () => {
    const loose = appFixture({
        'tsconfig.json': JSON.stringify({
            compilerOptions: {
                strict: false,
                target: 'esnext',
                module: 'preserve',
                moduleResolution: 'bundler',
                allowImportingTsExtensions: true,
                noEmit: true,
                skipLibCheck: true,
            },
            include: ['.'],
        }),
        'index.abide': `<script>
import { reactive } from '@abide/abide'

type Thing = { go: () => void }
let thing = reactive<Thing | undefined>(undefined)
const run = () => thing?.go()
</script>
<button onclick={run}>go</button>`,
    })
    expect(await checkApp(loose)).toEqual([])
}, 60_000)

// 33.23 THROUGH `abide check` — a component typed `& Attributes<'button'>` that spreads its rest onto a
// `<button>`: a caller's static text, a bare attribute, microdata and a typed listener are each held
// to what a button takes, and a `type` it does not take is refused. THE REVERT: drop `Written` from
// `Attributes`; `tabindex="-1"` is text where a number is due and is refused beside `type="banana"`.
test('a component typed by Attributes holds its callers to the element — 33.23', async () => {
    const attributed = appFixture({
        'lib/Button.abide': `<script>
import { props, type Attributes } from '@abide/abide'

const SIZES = { sm: 'p-1', md: 'p-2' }

const { size = 'md', ...attributes } = props<{ size?: keyof typeof SIZES } & Attributes<'button'>>()
</script>

<button class={SIZES[size]} {...attributes}><slot/></button>`,
        'index.abide': `<script>
import Button from '#src/lib/Button.abide'
</script>
<Button size="sm" type="submit" tabindex="-1" disabled itemprop="action" aria-disabled={true} data-id="7" onclick={(event) => console.log(event.currentTarget.form, event.clientX)}>go</Button>
<Button type="banana">no</Button>`,
    })
    expect(
        (await checkApp(attributed)).map(({ path, line, code }) => ({
            file: path.slice(path.lastIndexOf('/') + 1),
            line,
            code,
        })),
    ).toEqual([{ file: 'index.abide', line: 5, code: 2322 }])
}, 60_000)

// 33.26 THROUGH `abide check` — an icon typed `Attributes<'svg'>`: `viewBox` keeps its case on the
// component tag and is typed, and an attribute SVG does not have is refused. THE REVERT: type an SVG
// tag by the HTML derivation; the first icon's `viewBox` is refused beside the second's `radius`.
test('a component typed by Attributes over an SVG element holds its callers to it — 33.26', async () => {
    const icon = appFixture({
        'lib/Icon.abide': `<script>
import { props, type Attributes } from '@abide/abide'

const { class: className = '', ...attributes } = props<Attributes<'svg'>>()
</script>

<svg class="size-6 {className}" fill="none" stroke="currentColor" {...attributes}><slot/></svg>`,
        'index.abide': `<script>
import Icon from '#src/lib/Icon.abide'
</script>
<Icon viewBox="0 0 24 24" stroke-width={1.5} aria-hidden="true"><path d="M0 0"/></Icon>
<Icon radius="4"/>`,
    })
    expect(
        (await checkApp(icon)).map(({ path, line, code }) => ({
            file: path.slice(path.lastIndexOf('/') + 1),
            line,
            code,
        })),
    ).toEqual([{ file: 'index.abide', line: 5, code: 2353 }])
}, 60_000)

// 34.13 — A GENERIC COMPONENT: its body is checked for every `Item` at once, and a caller's
// props infer it. The first caller is right and its handler reads a field only its own type has;
// the second hands a handler for another type, and the third a list the constraint refuses. THE
// REVERT: drop `genericDeclarations` from the projection; `Item` is a name nothing declares and the
// component's own lines are refused (TS2304) beside the two callers.
test('a generic component is checked in its body and inferred at its callers — 34.13', async () => {
    const generic = appFixture({
        'lib/Select.abide': `<script generics="Item extends { id: string; label: string }">
import { props } from '@abide/abide'
const { items, onpick } = props<{ items: Item[]; onpick: (item: Item) => void }>()
const label: string = items[0]?.label ?? ''
</script>
<ul>{#for item of items by item.id}<li onclick={() => onpick(item)}>{item.label}</li>{/for}</ul><p>{label}</p>`,
        'index.abide': `<script>
import Select from '#src/lib/Select.abide'
type Film = { id: string; label: string; year: number }
const films: Film[] = [{ id: 'a', label: 'Alien', year: 1979 }]
function picked(film: Film) { const year: number = film.year; void year }
function other(film: { id: string; label: string; year: string }) { void film }
</script>
<Select items={films} onpick={picked}/>
<Select items={films} onpick={other}/>
<Select items={[{ id: 1 }]} onpick={() => {}}/>`,
    })
    const found = await checkApp(generic)
    expect(
        found.map(({ path, line, code }) => ({
            file: path.slice(path.lastIndexOf('/') + 1),
            line,
            code,
        })),
    ).toEqual([
        { file: 'index.abide', line: 9, code: 2322 },
        { file: 'index.abide', line: 10, code: 2322 },
    ])
}, 60_000)

// 32.32 — A VALUE DECLARED IN ANOTHER MODULE KEYS BY ITS `by` TOO, imported under its own name or
// another. THE REVERT: read `by` off the page's own setup text rather than the checker's
// declaration; both imported loops warn (3 against 1).
test('an unkeyed loop over an imported value that declares `by` does not warn — 32.32', async () => {
    const imported = appFixture({
        'lib/rows.ts': `import { reactive } from '@abide/abide'
export const shared = reactive([{ id: 1 }], { by: 'id' })
export const plain = reactive([{ id: 1 }])
`,
        'index.abide': `<script>
import { plain, shared } from '#src/lib/rows.ts'
import { shared as renamed } from '#src/lib/rows.ts'
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

// A REFUSAL ONLY THE WHOLE APP CAN SEE is a finding too: a handler file whose default no handler
// declares type-checks, and only the emit refuses it. THE REVERT: skip `emitApp` in `compiled` when
// checking; the check reads 0 refusals where 1 is due.
test('a check reports what only building the whole app refuses — 16.73', async () => {
    const stray = appFixture({
        'index.abide': '<p>hello</p>',
        'things/answer.ts': 'export default 42\n',
    })
    const refused = (await checkApp(stray)).filter((diagnosis) =>
        diagnosis.message.includes('16.73'),
    )
    expect(refused.length).toBe(1)
}, 60_000)

// 38.33, 34.20 — A REFUSAL OF WHERE A FILE SITS IS A FINDING AT THAT FILE, beside every other the app
// has: a server block under a `public` directory, and a page that does not parse. THE REVERT: refuse
// 34.20 at the app's root (`refusals.at(root, …)` in `appLayout`'s `refusePlace`), as the emit once
// threw it; the finding names the root, not `public/Widget.abide`.
test('a check reports a 34.20 refusal at its file beside a parse refusal — 38.33, 34.20', async () => {
    const found = await checkApp(
        appFixture({
            'index.abide': '<p>home</p>',
            'broken/index.abide':
                '{#component row({ label })}<li>{label}</li>{/component}',
            'public/Widget.abide': `<script server>
const answer = 42
</script>

<p>widget</p>`,
        }),
    )
    const placed = found.filter((diagnosis) =>
        diagnosis.message.includes('34.20'),
    )
    expect(placed.length).toBe(1)
    expect(placed[0]?.path).toEndWith('/public/Widget.abide')
    expect(found.some((diagnosis) => diagnosis.message.includes('32.39'))).toBe(
        true,
    )
}, 60_000)

// 38.33 — WHAT ONLY THE WHOLE APP CAN REFUSE IS FOUND BESIDE A FILE THAT DID NOT PARSE: the emit runs
// over every file that got that far, so one broken page does not hide a handler file the emit refuses.
// THE REVERT: skip `emitApp` in `compiled` when a refusal was already kept; 16.73 goes unreported, 0
// findings where 1 is due.
test('a check reports an emit refusal beside a parse refusal — 38.33, 16.73', async () => {
    const found = await checkApp(
        appFixture({
            'index.abide': '<p>home</p>',
            'broken/index.abide':
                '{#component row({ label })}<li>{label}</li>{/component}',
            'things/answer.ts': 'export default 42\n',
        }),
    )
    expect(
        found.filter((diagnosis) => diagnosis.message.includes('16.73')).length,
    ).toBe(1)
    expect(found.some((diagnosis) => diagnosis.message.includes('32.39'))).toBe(
        true,
    )
}, 60_000)

// 38.33 — A TREE THE BUILD'S WALK REFUSES (23.18) is a finding at the file, beside every type error
// the rest of the app has. THE REVERT: hand `appFiles` a throwing `Refusals` in `appLayout`; the
// check throws the 23.18 refusal and reports nothing else.
test('a check reports a tree refusal at its file beside the type errors — 38.33, 23.18', async () => {
    const stray = appFixture({
        'index.abide': '<script>\nconst label: string = 5\n</script>\n',
        'media/lib/index.abide': '<p>stray</p>',
    })
    const found = await checkApp(stray)
    const tree = found.filter((diagnosis) =>
        diagnosis.message.includes('23.18'),
    )
    expect(tree.length).toBe(1)
    expect(tree[0]?.path).toEndWith('media/lib/index.abide')
    expect(found.some((diagnosis) => diagnosis.code === 2322)).toBe(true)
}, 60_000)

// 38.33, 34.17 — AN EXPORT IN A `.abide` IS A FINDING AT ITS FILE, not the end of the check: the
// rest of the app is checked around it, as a parse refusal is. THE REVERT: let `session.lints`
// project the files `readSources` already refused; the check throws the 34.17 refusal and reports
// nothing else.
test('a check reports an export in a .abide at its file beside the type errors — 38.33, 34.17', async () => {
    const exporting = appFixture({
        'index.abide': '<script>\nconst label: string = 5\n</script>\n',
        'media/index.abide':
            '<script>\nexport const answer = 42\n</script>\n<p>x</p>',
    })
    let found: Diagnosis[] = []
    let thrown = ''
    try {
        found = await checkApp(exporting)
    } catch (error) {
        thrown = String(error)
    }
    expect(thrown).toBe('')
    const exported = found.filter((diagnosis) =>
        diagnosis.message.includes('34.17'),
    )
    expect(exported.length).toBe(1)
    expect(exported[0]?.path).toEndWith('media/index.abide')
    expect(found.some((diagnosis) => diagnosis.code === 2322)).toBe(true)
}, 60_000)

// 38.33, 34.17 — AND ONE ANOTHER FILE IMPORTS: the import brings the refused component back into the
// app, and it is still the one finding at its file. THE REVERT: project only the app's own files
// (`layout.own`) in `compiled`; the import is read unprojected, `session.lints` projects it, and the
// check throws the 34.17 refusal instead of answering.
test('a check reports an export in an imported .abide at its file — 38.33, 34.17', async () => {
    const imported = appFixture({
        'index.abide':
            "<script>\nimport Card from '#src/lib/Card.abide'\nconst label: string = 5\n</script>\n<Card/>",
        'lib/Card.abide':
            '<script>\nexport const answer = 42\n</script>\n<p>card</p>',
    })
    let found: Diagnosis[] = []
    let thrown = ''
    try {
        found = await checkApp(imported)
    } catch (error) {
        thrown = String(error)
    }
    expect(thrown).toBe('')
    const exported = found.filter((diagnosis) =>
        diagnosis.message.includes('34.17'),
    )
    expect(exported.length).toBe(1)
    expect(exported[0]?.path).toEndWith('lib/Card.abide')
    expect(found.some((diagnosis) => diagnosis.code === 2322)).toBe(true)
}, 60_000)

// 38.33 — WHAT THE WHOLE APP REFUSES IS FOUND AT EACH FILE, every one of them, as a file's own
// refusals are: two handler files that each export a second name are two findings, one at each.
// THE REVERT: hand `emitApp` no `refuse` in `checkApp`; the first refusal throws, and the check
// reports 1 finding at the app's root where 2 are due at the files.
test('a check reports every handler file refusal at its own file — 38.33, 16.73', async () => {
    const twice = appFixture({
        'index.abide': '<p>home</p>',
        'media/getOne.ts':
            "import { GET } from '@abide/abide/server'\n\nexport const extra = 1\nexport default GET(() => 1)\n",
        'media/getTwo.ts':
            "import { GET } from '@abide/abide/server'\n\nexport const more = 2\nexport default GET(() => 2)\n",
    })
    const at: string[] = []
    for (const diagnosis of await checkApp(twice))
        if (diagnosis.message.includes('16.73'))
            at.push(relative(realpathSync(twice), diagnosis.path))
    expect(at.sort()).toEqual(['media/getOne.ts', 'media/getTwo.ts'])
}, 60_000)

// 38.33, 16.39 — WHAT THE CHECKER'S READ OF A HANDLER REFUSES is a finding at the handler's file,
// each one, beside a refusal of another file: two handlers nesting a `Reactive` and a handler file
// exporting a second name are three findings at three files. THE REVERT: let `declaredExports`
// throw what it refuses; the check reads 1 finding at the app's root where 3 are due at the files.
test("a check reports each 16.39 refusal at its file beside another file's — 38.33, 16.39", async () => {
    const nesting = appFixture({
        'index.abide': '<p>home</p>',
        'lib/user.ts': `import { reactive } from '@abide/abide'

export const user = reactive({ name: 'Ada' })
`,
        'people/getProfile.ts': `import { GET } from '@abide/abide/server'
import { user } from '../lib/user.ts'

export default GET(() => ({ user }))
`,
        'people/getRows.ts': `import { GET } from '@abide/abide/server'
import { user } from '../lib/user.ts'

export default GET(() => [{ user }])
`,
        'media/getTwo.ts':
            "import { GET } from '@abide/abide/server'\n\nexport const more = 2\nexport default GET(() => 2)\n",
    })
    const at: string[] = []
    for (const diagnosis of await checkApp(nesting))
        if (
            diagnosis.category === 'error' &&
            /16\.(39|73)/.test(diagnosis.message)
        )
            at.push(
                `${relative(realpathSync(nesting), diagnosis.path)} ${diagnosis.message.includes('16.39') ? '16.39' : '16.73'}`,
            )
    expect(at.sort()).toEqual([
        'media/getTwo.ts 16.73',
        'people/getProfile.ts 16.39',
        'people/getRows.ts 16.39',
    ])
}, 60_000)

// 38.33, 23.22 — A STRAY IN AN ADDRESS DIRECTORY is reported where it stands, by the same walk the
// build refuses it with, and the rest of the app is still checked. THE REVERT: drop the `appFiles`
// call collecting refusals in `checkApp`; the check reports the type error alone and the stray
// goes unfound, 0 findings at `media/notes.md` where 1 is due.
test('a check reports a stray file in an address directory at the file — 38.33, 23.22', async () => {
    const stray = appFixture({
        'index.abide': '<script>\nconst label: string = 5\n</script>\n',
        'media/notes.md': '# notes\n',
    })
    const found = await checkApp(stray)
    const tree = found.filter((diagnosis) =>
        diagnosis.message.includes('23.22'),
    )
    expect(tree.length).toBe(1)
    expect(tree[0]?.path).toEndWith('media/notes.md')
    expect(tree[0]?.message).toContain('lib directory')
    expect(found.some((diagnosis) => diagnosis.code === 2322)).toBe(true)
}, 60_000)

// 16.39 —A `Reactive` NESTED IN WHAT A HANDLER RETURNS is refused, by the handler and the path to
// it; one returned whole is adopted (11.12) and is not — `getUser` is listed first, so a refusal
// of it would be the one read. THE REVERT: skip `nestedReactiveIn` in `declaredExports`; the check reads
// 0 refusals where 1 is due, in each app.
test('a handler returning a Reactive nested in its value is refused by path — 16.39', async () => {
    const refusals = async (name: string, handler: string) => {
        const said: string[] = []
        const app = appFixture({
            'index.abide': '<p>hello</p>',
            'lib/user.ts': `import { reactive } from '@abide/abide'

export const user = reactive({ name: 'Ada' })
`,
            'people/getUser.ts': `import { GET } from '@abide/abide/server'
import { user } from '../lib/user.ts'

export default GET(() => user)
`,
            ...(name === ''
                ? {}
                : {
                      [`people/${name}.ts`]: `import { GET } from '@abide/abide/server'
import { user } from '../lib/user.ts'

export default ${handler}
`,
                  }),
        })
        for (const diagnosis of await checkApp(app))
            if (diagnosis.message.includes('16.39'))
                said.push(diagnosis.message)
        return said
    }
    const member = await refusals(
        'getProfile',
        'GET(() => ({ user, since: 1815 }))',
    )
    expect(member.length).toBe(1)
    expect(member[0]).toContain('people/getProfile.ts')
    expect(member[0]).toContain('`default` returns a `Reactive` at `.user`')
    const item = await refusals(
        'getRows',
        'GET(async () => [{ owner: { held: user } }])',
    )
    expect(item.length).toBe(1)
    expect(item[0]).toContain('people/getRows.ts')
    expect(item[0]).toContain(
        '`default` returns a `Reactive` at `[].owner.held`',
    )
    expect(await refusals('', '')).toEqual([])
    // As deep as `argsSchemaOf` walks and no deeper: seven members down is read, eight is past
    // `DEEPEST`. THE REVERT: `walk.depth > DEEPEST` in `nestedReactiveIn` refuses the eighth, 1
    // where 0 is due.
    const deepest = await refusals(
        'getDeep',
        'GET(() => ({ a: { b: { c: { d: { e: { f: { g: user } } } } } } }))',
    )
    expect(deepest.length).toBe(1)
    expect(deepest[0]).toContain('at `.a.b.c.d.e.f.g`')
    const past = await refusals(
        'getPast',
        'GET(() => ({ a: { b: { c: { d: { e: { f: { g: { h: user } } } } } } } }))',
    )
    expect(past).toEqual([])
}, 60_000)

// 32.6 — A `bind:` WITH NOTHING BOUND IS NO PROP, to the checker as to the build: both key a tag's
// props by `propKeyOf`. THE REVERT: key a `bind:` whatever it holds in `projectShadow`; the checker
// then holds `""` to `Reactive<string>` (TS2322) beside the build's refusal, two answers to one tag.
test('a bind: with nothing bound is refused, and is no prop to the checker — 32.6', async () => {
    const unbound = appFixture({
        'index.abide': `<script>
import Held from '#src/lib/Held.abide'
</script>
<Held bind:value/>`,
        'lib/Held.abide': HELD,
    })
    const codes: number[] = []
    for (const diagnosis of await checkApp(unbound)) codes.push(diagnosis.code)
    // The build's refusal, and the prop the tag never passed.
    expect(codes).toEqual([0, 2741])
}, 60_000)

// THE SAME WARNINGS FROM THE BUILD, which is what `abide build` and `abide dev` print. THE REVERT:
// hand back `[]` for `warnings` in `compileApp`; this reads 0 where 8 are due.
test('a compile carries the warnings a check reports — 14.14, 32.14', async () => {
    const warnedOnly = appFixture({ 'index.abide': WARNED })
    const compiled = await compileApp(warnedOnly)
    expect(compiled.warnings.length).toBe(8)
    expect(compiled.warnings[0]?.path).toEndWith('index.abide')
}, 60_000)

// A FAILURE WHERE ANY FINDING IS AN ERROR, and a success where they are warnings alone — which is
// what `abide check && abide build` in CI rests on. THE REVERT: return 0 from `check` whatever it
// found; the first spawn exits 0 over four errors.
test('abide check fails on an error and passes on warnings alone — 38.3', async () => {
    const all = await spawned(['bun', BIN, 'check', '--root', app], {
        cwd: app,
    })
    expect(all.exitCode).toBe(1)
    const said = all.stdout
    expect(said).toContain(
        `broken/index.abide:${place(BROKEN, 'toUpperCase').line}:`,
    )
    const warned = await spawned(
        ['bun', BIN, 'check', '--root', app, 'warned'],
        { cwd: app },
    )
    expect(warned.exitCode).toBe(0)
    expect(warned.stdout).toContain('0 errors, 8 warnings')
}, 60_000)
