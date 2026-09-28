// 14.8, 34.9–34.12 — A BRANCH-LOCAL `<script>`: setup for the body it is written in, run once each time
// that body is built, tracking nothing, with its names in scope for that body alone. Rendered on the server,
// hydrated and then driven on the client, because each side builds a body its own way.

import { afterAll, expect, test } from 'bun:test'
import { compileFile, emitClient, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'
import { pageRegion } from '#ui/regions.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import { closeTyped } from './typed.ts'

afterAll(closeTyped)

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)
afterAll(() => {
    session.close()
    removeTemporaryModules()
})

// How many times each body's setup ran, by what it names itself.
const runs = (): Record<string, number> =>
    ((globalThis as { __setups?: Record<string, number> }).__setups ??= {})

async function mountSource(source: string): Promise<string> {
    ;(globalThis as { __setups?: Record<string, number> }).__setups = {}
    const file = parseAbide(source)
    const names = await session.reads(`${ROOT}src/branch.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(source, names),
        'Page.client.ts': emitClient(file, names),
    })
    const { default: Component } = await import(`${dir}/Page.ts`)
    let html = ''
    for await (const chunk of render(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    mount(pageRegion(document.body))
    return html
}

const ROWS = `<script>
import { reactive } from 'abide'

let rows = reactive([
    { id: 'ada', name: 'Ada' },
    { id: 'grace', name: 'Grace' },
])
let suffix = reactive('!')

function add() {
    rows = [...rows, { id: 'katherine', name: 'Katherine' }]
}

function shout() {
    suffix = '!!'
}

// Counts the list's reads of its subject, which is one per reconcile.
function listed() {
    globalThis.__setups.subject = (globalThis.__setups.subject ?? 0) + 1
    return rows
}
</script>

<ul id="list">{#for row of listed() by row.id}<script>
const setups = globalThis.__setups
setups[row.id] = (setups[row.id] ?? 0) + 1
const label = row.name.toUpperCase() + suffix
</script><li data-id={row.id}>{label}</li>{/for}</ul>
<button id="add" onclick={add}>add</button>
<button id="shout" onclick={shout}>shout</button>`

const labels = (): string[] =>
    [...document.querySelectorAll('#list li')].map(
        (node) => node.textContent ?? '',
    )

// THE REVERT: lift the script into component setup in `parseAbide` (drop the 14.8 arm); `row` is out
// of scope there, and the page does not compile.
test("a row's script is set up for that row, on the server and after hydration", async () => {
    const html = await mountSource(ROWS)
    expect(html).toContain('>ADA!<')
    expect(html).toContain('>GRACE!<')
    expect(labels()).toEqual(['ADA!', 'GRACE!'])
})

// ONCE PER ROW: the server ran each row's script, hydration ran it again for the row's bindings, and a
// row added later runs it once. THE REVERT: call `list.setUp` again for the mount in `makeRow` rather
// than handing it over; the added row is set up 2 times where 1 is due.
test("a row's script runs once for the row, and once for a row added after", async () => {
    await mountSource(ROWS)
    const hydrated = { ...runs() }
    ;(document.querySelector('#add') as HTMLElement).click()
    flushSync()
    expect(labels()).toEqual(['ADA!', 'GRACE!', 'KATHERINE!'])
    expect(runs().katherine).toBe(1)
    // The rows that stood were not set up again by the add.
    expect(runs().ada).toBe(hydrated.ada)
    expect(runs().grace).toBe(hydrated.grace)
})

// 14.8 — IT TRACKS NOTHING. The script read `suffix`, and a change to it neither re-runs the script nor
// re-reconciles the list. THE REVERT: call `settleList` tracked in `updateList`; the list's watch
// reads `suffix` through the script, and the change re-reads the subject — the kept rows are not set
// up again, so what the revert costs is the reconcile, 1 where 0 are due.
test("a row's script tracks nothing it reads", async () => {
    await mountSource(ROWS)
    const before = { ...runs() }
    ;(document.querySelector('#shout') as HTMLElement).click()
    flushSync()
    expect(runs()).toEqual(before)
    // What the script computed stands: it was set up, not bound.
    expect(labels()).toEqual(['ADA!', 'GRACE!'])
})

test('two scripts in one body are refused', () => {
    expect(() =>
        parseAbide(
            '{#for x of [1]}<script>const a = 1</script><script>const b = 2</script><p>{a}</p>{/for}',
        ),
    ).toThrow('14.8')
})

const ARMS = `<script>
import { reactive } from 'abide'

let open = reactive(true)
let name = reactive('ada')

function toggle() {
    open = !open
}
</script>

{#if open}<script>
const setups = globalThis.__setups
setups.arm = (setups.arm ?? 0) + 1
const greeting = 'hello ' + name
</script><b id="greeting">{greeting}</b>{:else}<i id="closed">closed</i>{/if}
<button id="toggle" onclick={toggle}>toggle</button>`

const text = (id: string): string | null | undefined =>
    document.querySelector(id)?.textContent

// AN ARM IS SET UP EACH TIME IT IS SWAPPED IN, and once: the server ran it for its markup, hydration
// for its bindings, and each return to it after that runs it once more. THE REVERT: drop the
// `${name}_local = …` step from `emitBlock`'s watch; the arm has nothing set up to mount from, and its
// mount throws on the `null` it finds. Dropping the `;` the projection opens the arm's braces behind
// fails this too, for the reason given there: the subject lowers as written and never swaps.
test("an arm's script runs once each time the arm is swapped in", async () => {
    const html = await mountSource(ARMS)
    expect(html).toContain('>hello ada<')
    expect(text('#greeting')).toBe('hello ada')
    const hydrated = runs().arm as number
    ;(document.querySelector('#toggle') as HTMLElement).click()
    flushSync()
    expect(text('#closed')).toBe('closed')
    expect(runs().arm).toBe(hydrated)
    ;(document.querySelector('#toggle') as HTMLElement).click()
    flushSync()
    expect(text('#greeting')).toBe('hello ada')
    expect(runs().arm).toBe(hydrated + 1)
})

test('a script inside a {#try} is refused', () => {
    expect(() =>
        parseAbide('{#try}<script>const a = 1</script><p>{a}</p>{/try}'),
    ).toThrow('34.12')
})

const ARM_VALUE = `<script>
import { reactive } from 'abide'
</script>

{#if true}<script>
const inner = reactive(2)

function bump() {
    inner = inner + 1
}
</script><b id="inner">{inner + 1}</b><button id="bump" onclick={bump}>bump</button>{/if}`

// 31.1 REACHES A BRANCH-LOCAL `<script>` — its names are the body's own, read and written by name
// like the page's. THE REVERT: collect names from the scripts block alone; `inner` stays the value
// object and renders `[object Object]1`, and the write never reaches the slot.
test("a value an arm's script declares is read and written by name", async () => {
    const html = await mountSource(ARM_VALUE)
    expect(html).toContain('>3<')
    expect(text('#inner')).toBe('3')
    ;(document.querySelector('#bump') as HTMLElement).click()
    flushSync()
    expect(text('#inner')).toBe('4')
})

// 14.16 REACHES AN ARM, and an arm's subject: each is a template position as a top-level slot is,
// and projecting `{#if}` as the `if` it is must not hide it. A created function inside the slot is
// still its own, and an arm's `<script>` tracks nothing (14.8), so neither warns. THE REVERT: find a
// template position only at the file's top; both reads in the arm go unwarned (0 against 2).
test("a read an arm's slot defers warns as a top-level one does — 14.16", async () => {
    const source = `<script>
import { reactive } from 'abide'

let one = reactive(1)
</script>

{#if (() => one)()}<script>
setTimeout(() => one, 0)
</script><p>{setTimeout(() => one, 0)}</p><p>{[1].map(() => { (one) })}</p>{/if}
{#if setTimeout(() => one, 0)}<b>x</b>{/if}`
    const { warnings } = await session.readsFor([
        {
            path: `${ROOT}src/branch.abide`,
            file: parseAbide(source),
            text: source,
        },
    ])
    const deferred = warnings.filter((warning) =>
        warning.message.includes('14.16'),
    )
    expect(deferred.map(({ line }) => line)).toEqual([9, 10])
})

// 38.3 REACHES A BRANCH-LOCAL NAME: it is checked as the call it lowers to, where the file's record
// of values cannot see it, and two bodies declaring one spelling are two names. THE REVERT: send a
// local read through `__values` like the page's; the clean file reports `Cannot find name 'inner'`.
test("an arm's value checks clean, and a wrong use of it is reported — 38.3", async () => {
    const arms = (use: string) => `<script>
import { reactive } from 'abide'
</script>

{#if true}<script>
const inner = reactive(2)
function bump() { inner = inner + 1 }
</script><b>{inner + 1}</b><button onclick={bump}>b</button>{/if}
{#for x of [1]}<script>
const inner = reactive('s')
</script><i>{${use}}</i>{/for}`
    const path = `${ROOT}src/branch.abide`
    const diagnosed = async (source: string) => {
        const file = parseAbide(source)
        const reads = await session.reads(path, file)
        return session.diagnose(
            [{ path, text: source, file, reads }],
            `${ROOT}src`,
            false,
        )
    }
    expect(await diagnosed(arms('inner.toUpperCase()'))).toEqual([])
    const wrong = await diagnosed(arms('inner.toFixed()'))
    expect(wrong.map(({ line }) => line)).toEqual([11])
})

// AN ARM'S SCRIPT IS STATEMENTS, NOT A VALUE. A template position is parenthesized where a comma or
// a trailing comment would change what the emit splices it into (19.12); a script spliced the same
// way is `(const a = 1, b = 2)`, which is not a program.
//
// THE REVERT: lower a setup through `Lowering.expression` rather than `Lowering.setup`. Both
// server module then fails to build — `Unexpected const` — where `1 2` is due.
test("an arm's script with a comma declaration and a trailing comment is spliced as written", async () => {
    const html = await mountSource(
        `{#if true}<script>\nconst a = 1, b = 2 // two at once\n</script><b id="pair">{a} {b}</b>{/if}`,
    )
    expect(html).toContain('>1 2<')
    expect(text('#pair')).toBe('1 2')
})
