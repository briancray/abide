// 32.39 TO 32.49 — `{#component Name(pattern)}`, A COMPONENT DECLARED IN THE FILE THAT USES IT. It
// compiles as the file it would be moved into (`inlineSources`), so what is asserted here is that
// the file path's contracts hold for it unchanged: the server renders it where it stands, the
// client hydrates it without making a node, and a prop is a live read — counted, not compared.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { emitClient, emitComponent, parseAbide } from '#compiler'
import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import { withInline } from '#compiler/inlineSources.ts'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'
import { pageRegion } from '#ui/regions.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)

afterAll(() => {
    session.close()
    removeTemporaryModules()
})

// Two invocations of one inline component, each handed a live read of the page's own value.
const LEDGER = `<script>
import { reactive } from 'abide'

let lines = reactive(2)
</script>

{#component Line({ label, amount }: { label: string; amount: number })}
<li><span>{label}</span><strong>{amount.toFixed(2)}</strong></li>
{/component}

<ul><Line label="net" amount={lines * 10}/><Line label="gross" amount={lines * 12}/></ul>
<button onclick={() => { lines = lines + 1 }}>+</button>`

// A page and every inline component it declares, compiled as the build compiles them and mounted
// into the markup the server wrote.
async function mountPage(
    page: string,
): Promise<{ html: string; mount: (root: unknown) => void }> {
    const sources = withInline([
        { path: `${ROOT}src/Page.abide`, text: page, file: parseAbide(page) },
    ])
    const { reads } = await session.readsFor(sources)
    const modules: Record<string, string> = {}
    for (let at = 0; at < sources.length; at += 1) {
        const source = sources[at] as (typeof sources)[number]
        const name = source.path
            .slice(source.path.lastIndexOf('/') + 1)
            .replace(/\.abide$/, '')
        modules[`${name}.ts`] = emitComponent(source.file, reads[at])
        modules[`${name}.client.ts`] =
            emitClient(
                source.file,
                reads[at],
                source.inlineOf === undefined ? 'none' : 'invoked',
            ) || 'export default () => {}'
    }
    const dir = temporaryModule(modules)
    const { default: Component } = await import(`${dir}/Page.ts`)
    const html = new TextDecoder().decode(
        await render(
            Component,
            '<!doctype html><html><head></head><body></body></html>',
        ),
    )
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    return { html, mount }
}

// THE REVERT: drop the import `withInline` adds to the declaring file; the page's `<Line/>` is an
// unbound name, and the render throws `Line is not defined` before any markup is written.
test('an inline component renders where it stands, once per invocation — 32.39', async () => {
    const { html } = await mountPage(LEDGER)
    expect(html).toContain(
        '<ul><!--[--><li><span>net</span><strong>20.00</strong></li><!--]--><!--[--><li><span>gross</span><strong>24.00</strong></li><!--]--></ul>',
    )
})

// 41.9 AND 33.5 THROUGH AN INLINE COMPONENT: hydration adopts what the server wrote, and a click
// wakes one binding per invocation and builds nothing. THE REVERT: hand the inline component the
// no-op client module a file with nothing to mount gets; the click moves `lines` and `net` stays
// `20.00`.
test('an inline component hydrates with no node made, and a prop re-reads live — 32.39, 33.5', async () => {
    const { mount } = await mountPage(LEDGER)
    const hydrated = measure(() => {
        mount(pageRegion(document.body))
        flushSync()
    })
    expect(hydrated.nodesCreated).toBe(0)

    const [net, gross] = document.querySelectorAll('strong')
    const before = (net as Element).firstChild
    const work = measure(() => {
        ;(document.querySelector('button') as HTMLElement).click()
        flushSync()
    })
    expect((net as Element).textContent).toBe('30.00')
    expect((gross as Element).textContent).toBe('36.00')
    expect((net as Element).firstChild).toBe(before)
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
    // One binding per invocation, and nothing else: the page reads `lines` only through the props.
    expect(work.wakes).toBe(2)
})

// 32.18 — `<slot/>` IN AN INLINE COMPONENT is a file component's: the caller's markup, or the
// fallback. And 32.43 — invoked above the block that declares it. THE REVERT: drop `holdsSlot` from
// `Lowering.takesProps`; the component is emitted taking no record, and the render throws on the
// `__props` it reads the children from.
test('children render into an inline component slot, and the fallback where none were passed — 32.18, 32.43', async () => {
    const { html } = await mountPage(`<Panel><b>given</b></Panel><Panel/>
{#component Panel()}
<section><slot>empty</slot></section>
{/component}`)
    expect(html).toContain(
        '<section><!--[--><b>given</b><!--]--></section><!--]--><!--[--><section><!--[-->empty<!--]--></section>',
    )
})

// 32.46 AND 32.42 — its own `<script>` is its per-instance setup, and it sees every inline
// component of its file, itself included. THE REVERT: drop `inlineComponent.setup` from the scripts
// `withInline` hands it; `depth` is unbound and the render throws before any markup is written.
test('an inline component sets itself up and invokes itself — 32.42, 32.46', async () => {
    const { html } =
        await mountPage(`{#component Nest({ depth }: { depth: number })}
<script>
const label = 'level ' + depth
</script>
<i>{label}{#if depth > 1}<Nest depth={depth - 1}/>{/if}</i>
{/component}
<Nest depth={2}/>`)
    expect(html).toContain(
        '<i>level 2<!--[--><!--[--><i>level 1<!--[--><!--]--></i><!--]--><!--]--></i>',
    )
})

// 38.40 — A HOVER INSIDE THE BLOCK IS ANSWERED BY THE COMPONENT'S OWN LOWERING, which is where the
// body is typed. THE REVERT: answer every offset from the file's own (`inlineAt` returning
// `abidePath`); the file's projection holds nothing of the body, and the hover is undefined.
test('a hover inside an inline component is answered — 38.40', async () => {
    const page = `{#component Price({ amount }: { amount: number })}
<b>{amount.toFixed(2)}</b>
{/component}
<Price amount={3}/>`
    const path = `${ROOT}src/Hover.abide`
    const sources = withInline([{ path, text: page, file: parseAbide(page) }])
    const { reads } = await session.readsFor(sources)
    const typed = sources.map((source, at) => ({
        ...source,
        reads: reads[at] ?? [],
    }))
    expect(await session.diagnose(typed, ROOT, false)).toEqual([])
    const hover = await session.inspect(path, page, page.indexOf('toFixed'))
    expect(hover?.signature).toContain('(method) toFixed(')
})

// THE REVERT: drop the `isComponentTag` refusal in `inlineComponent`; the file parses, and the
// `<row/>` that would invoke it is written as an element.
test('an inline component named in lowercase is refused — 32.39', () => {
    expect(() =>
        parseAbide('{#component row({ label })}<li>{label}</li>{/component}'),
    ).toThrow(/\{#component row\} is not TitleCase.*RULEBOOK 32\.39/)
})

// THE REVERT: return early from `refuseEnclosingNames`; the build reads `count` as an undeclared
// global, and the refusal below never comes.
test("an inline component does not see its file's script — 32.41", async () => {
    const page = `<script>
import { reactive } from 'abide'

let count = reactive(0)
</script>

{#component Counter()}
<b>{count}</b>
{/component}

<Counter/>`
    let refused = ''
    try {
        await session.readsFor(
            withInline([
                {
                    path: `${ROOT}src/Scoped.abide`,
                    text: page,
                    file: parseAbide(page),
                },
            ]),
        )
    } catch (thrown) {
        refused = (thrown as Error).message
    }
    expect(refused).toContain('Scoped.abide:8:5')
    expect(refused).toContain(
        "{#component Counter} reads `count`, which its file's script declares",
    )
    expect(refused).toContain('RULEBOOK 32.41')
})

// THE REVERT: drop the import walk from `refuseCollisions`; the file parses, and the emitted
// module declares `Row` twice.
test('an inline component named as an import is refused, naming both — 32.49', () => {
    expect(() =>
        parseAbide(`<script>
import Row from './Row.abide'
</script>
{#component Row({ label })}<li>{label}</li>{/component}`),
    ).toThrow(
        "{#component Row} is declared inline and Row is also imported from './Row.abide'",
    )
})

// THE REVERT: drop the `open.length > 1` refusal; the block's body is parsed into the arm around
// it, and its name is never bound.
test('an inline component inside a block is refused — 32.44', () => {
    expect(() =>
        parseAbide('{#if on}{#component Row()}<li/>{/component}{/if}'),
    ).toThrow(/RULEBOOK 32\.44/)
})

let app = ''

beforeAll(async () => {
    app = appFixture({
        'ui/pages/page.abide': `<script>
import { reactive } from 'abide'

let count = reactive(0)
</script>

{#component Row({ label }: { label: string })}
<li class="row">{label}</li><style>li { font-weight: bold }</style>
{/component}

<ul><Row label={count}/><Row label="fine"/></ul>

<style>
.row { color: red }
</style>`,
        'ui/pages/body/page.abide': `<script>
import { missing } from './nowhere.ts'
</script>

{#component Tag({ label }: { label: string })}
<b>{label.toFixed(2)} {missing}</b>
{/component}

<Tag label="x"/>{missing}`,
    })
}, 60_000)

// A tag is held to the props its pattern's annotation declares, and a finding inside the body is on
// the file's own line. THE REVERTS: report an inline component's findings at its own path rather
// than its file's (`authoredPath`) — the `toFixed` finding is filed under `page.abide.Tag.abide`,
// which no editor has open; or keep its findings outside its block — the unresolved import is
// reported twice, once for the file and once for the copy the component carries.
test('abide check holds an inline component to its props, on the lines of its file — 32.40, 38.41', async () => {
    const found = await checkApp(app)
    const reported: {
        path: string
        line: number
        column: number
        code: number
    }[] = []
    for (const { path, line, column, code } of found)
        reported.push({ path: path.slice(app.length), line, column, code })
    expect(reported).toEqual([
        { path: '/ui/pages/body/page.abide', line: 2, column: 25, code: 2307 },
        { path: '/ui/pages/body/page.abide', line: 6, column: 11, code: 2551 },
        { path: '/ui/pages/page.abide', line: 11, column: 17, code: 2322 },
    ])
})

// 32.45 — THE FILE'S `<style>` REACHES THE ELEMENTS ITS INLINE COMPONENT WRITES, and the build files
// the component as a module of its own, invoked. THE REVERTS: skip the inline components in
// `emitApp`'s marking loop — the `<li>` carries no token, and `.row` matches nothing; or resolve no
// relative specifier `componentGraph` cannot hand to bun — the component is not invoked, and its
// client module fills no region the browser grew.
test('a build compiles an inline component as a module of its own, scoped by its file — 32.45', async () => {
    const compiled = await compileApp(app)
    const server = compiled.modules.get('ui/pages/page.abide.Row.ts') ?? ''
    const client =
        compiled.modules.get('ui/pages/page.abide.Row.client.ts') ?? ''
    const token = /li class=\\"row\\" (a-[\w]+) (a-[\w]+-0)/.exec(server)
    expect(token).not.toBeNull()
    const [, file, own] = token as RegExpExecArray
    const sheet = compiled.modules.get('ui/pages/page.style.css')
    expect(sheet).toContain(`.row[${file}]`)
    // 32.47 — and its own `<style>` is a body's, reaching its elements and no other.
    expect(sheet).toContain(`li[${own}]`)
    // Invoked, so it carries its own markup for a region the browser grew (32.17).
    expect(client).toContain('isEmptyRegion')
    expect(compiled.modules.get('ui/pages/page.ts')).toContain(
        "from './page.abide.Row.ts'",
    )
})
