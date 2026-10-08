// 32.16 — `{#try}`: A RENDER-TIME BOUNDARY OVER A REGION. A failure replaces the whole body with the
// catch arm, on the server as it renders and in the browser as a binding re-runs — and a body whose
// failure clears comes back.

import { afterAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { emitClient, emitComponent, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync, NotLanded } from '#shared'
import { Mismatch } from '#ui/Mismatch.ts'
import { markupNodes } from '#ui/parseMarkup.ts'
import { pageRegion } from '#ui/regions.ts'
import { BOUNDARY, Scope } from '#ui/Scope.ts'
import { TryRegion } from '#ui/TryRegion.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)

afterAll(async () => {
    await session.close()
    removeTemporaryModules()
})

// The docs' own example (`examples/try-region`), with the rate's starting value a parameter.
const pageWith = (rate: string) => `<script>
import { reactive } from 'abide'

let rate = reactive('${rate}')

function convert(typed: string) {
    const value = Number(typed)
    if (!(value > 0)) throw new Error('Rate must be a positive number.')
    return (1240 * value).toFixed(2)
}
</script>

<input id="rate" bind:value={rate}>

{#try}
    <ul class="fields">
        <li><span>invoice</span><strong>#4310</strong></li>
        <li><span>converted</span><strong id="converted">\${convert(rate)}</strong></li>
    </ul>
{:catch problem}
    <p class="status">{problem.message}</p>
{:finally}
    <small id="after">rates are indicative</small>
{/try}`

async function served(
    source: string,
    beforeMount?: () => void,
): Promise<string> {
    const file = parseAbide(source)
    const reads = await session.reads(`${ROOT}src/try.abide`, file)
    const dir = temporaryModule({
        'Page.ts': emitComponent(file, reads),
        'Page.client.ts': emitClient(file, reads),
    })
    const { default: Component } = await import(`${dir}/Page.ts`)
    let html = ''
    html += new TextDecoder().decode(
        await render(
            Component,
            '<!doctype html><html><head></head><body></body></html>',
        ),
    )
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + 6,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    beforeMount?.()
    mount(pageRegion(document.body))
    flushSync()
    return html
}

const typed = (value: string): void => {
    const input = document.getElementById('rate') as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input'))
    flushSync()
}

// 32.16 ON THE SERVER — THE BODY, OR WHERE IT THROWS THE CATCH IN ITS PLACE, and `{:finally}` either
// way. THE REVERT: render the body without the `try` around it; the render throws and the page is
// lost rather than the region.
// 32.56 — ONLY A `{#try}` HAS A CATCH OR A FINALLY. A `{:catch}` written in a `{#for}` was dropped
// without a word and the markup after it read as the row: every row rendered the catch. THE REVERT:
// drop the throw from `parseAbide`'s `:catch` arm; each spelling parses, and nothing is refused.
test('a {:catch} or a {:finally} outside a {#try} is refused — 32.56', () => {
    for (const source of [
        '{#for row of [1]}<i>{row}</i>{:catch}<p>caught</p>{/for}',
        '{#if true}<i>yes</i>{:finally}<p>after</p>{/if}',
        '{#try}{#if true}<i>yes</i>{:catch e}<p>no</p>{/if}{/try}',
        '<p>{:catch}</p>',
    ])
        expect(() => parseAbide(source), source).toThrow('32.56')
})

test('the server renders the body, or the catch where the body throws — 32.16', async () => {
    const good = await served(pageWith('1.09'))
    expect(good).toContain('<strong id="converted">$1351.60</strong>')
    expect(good).toContain('rates are indicative')
    expect(good).not.toContain('class="status"')

    const bad = await served(pageWith('nope'))
    expect(bad).toContain(
        '<p class="status">Rate must be a positive number.</p>',
    )
    expect(bad).toContain('rates are indicative')
    expect(bad).not.toContain('converted')
})

// 32.16 IN THE BROWSER — A BINDING THAT THROWS REPLACES THE WHOLE BODY, and one that stops throwing
// brings it back. THE REVERT: leave `Scope.watch` unwrapped under a boundary; the throw escapes the
// binding, the figure stays up beside nothing, and the catch never renders.
test('a failing binding swaps the body for the catch, and recovers — 32.16', async () => {
    await served(pageWith('1.09'))
    typed('0')
    expect(document.querySelector('.status')?.textContent).toBe(
        'Rate must be a positive number.',
    )
    expect(document.getElementById('converted')).toBeNull()
    expect(document.getElementById('after')).not.toBeNull()
    typed('2')
    expect(document.getElementById('converted')?.textContent).toBe('$2480.00')
    expect(document.querySelector('.status')).toBeNull()
})

// A PAGE THE SERVER PAINTED IN ITS CATCH hydrates without calling that a mismatch, and recovers.
test('a server-painted catch hydrates quietly and recovers — 32.16, 41.10', async () => {
    const warned: unknown[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    try {
        await served(pageWith('nope'))
        expect(document.querySelector('.status')?.textContent).toBe(
            'Rate must be a positive number.',
        )
        typed('1')
        expect(document.getElementById('converted')?.textContent).toBe(
            '$1240.00',
        )
    } finally {
        console.warn = warn
    }
    expect(
        warned.filter((line) => String(line).includes('abide:hydrate')),
    ).toEqual([])
})

// `{:finally}` STANDS AFTER THE REGION, not in either arm, so a swap leaves it where it was. THE
// REVERT: clone it into both arms; every swap rebuilds it and the node the reader was on is gone.
test('the finally markup is not rebuilt when the body fails — 32.16', async () => {
    await served(pageWith('1.09'))
    const after = document.getElementById('after')
    typed('0')
    expect(document.querySelector('.status')).not.toBeNull()
    expect(document.getElementById('after')).toBe(after)
    typed('2')
    expect(document.getElementById('after')).toBe(after)
})

// NEITHER A MISMATCH NOR A VALUE IN FLIGHT IS A FAILURE OF THE BODY, on the mount path or in a
// binding. THE REVERT: rethrow only `NotLanded` from a bound watch and only `Mismatch` from a mount;
// each case then reads the other one as the boundary's failure, and the catch arm shows it.
test('a mismatch or an unlanded value passes through the boundary — 2.13, 41.10', () => {
    const escaped = (run: () => unknown): unknown => {
        try {
            run()
        } catch (thrown) {
            return thrown
        }
        return undefined
    }
    const tryRegion = () => {
        const parent = document.createElement('div')
        const open = parent.appendChild(document.createComment('['))
        const close = parent.appendChild(document.createComment(']'))
        return new TryRegion({ open, close }, new Scope(), [])
    }
    const mounting = tryRegion()
    const unlanded = () => {
        throw new NotLanded({}, 'rate')
    }
    expect(escaped(() => mounting.guard(unlanded, unlanded))).toBeInstanceOf(
        NotLanded,
    )
    expect(mounting.failure.peek()).toBeUndefined()

    const binding = tryRegion()
    BOUNDARY.current = binding
    const scope = new Scope()
    BOUNDARY.current = undefined
    const mismatched = () => {
        throw new Mismatch('shape')
    }
    expect(escaped(() => scope.watch(mismatched))).toBeInstanceOf(Mismatch)
    expect(binding.failure.peek()).toBeUndefined()
})

// The same page with its body's evaluations COUNTED on the client, and a binding that can be told to
// disagree with what the server wrote.
const countedPage = (rate: string) =>
    pageWith(rate).replace(
        'function convert(typed: string) {',
        'function convert(typed: string) {\n    ;(globalThis as { converts?: number }).converts = ((globalThis as { converts?: number }).converts ?? 0) + 1',
    )
const counted = globalThis as { converts?: number }

// 32.16 AND 41.10 — THE ARM THE SERVER PAINTED IS THE ARM THE CLIENT HYDRATES. The open anchor of a
// region whose body threw on the server says so, so the catch's markup is ADOPTED — the very node the
// server sent — and the body is evaluated once: by the retry's first run, which finds the failure
// the catch binds and watches what it read in the same attempt (`TryRegion.follow`). THE REVERT: write the plain open anchor in the server's catch; the client walks the
// catch as if it were the body, throws, rebuilds the catch and evaluates the body three times.
test('a server-painted catch is adopted, and the body is evaluated once — 32.16', async () => {
    let sent: Element | null = null
    await served(countedPage('nope'), () => {
        sent = document.querySelector('.status')
        counted.converts = 0
    })
    expect(sent).not.toBeNull()
    expect({
        adopted: document.querySelector('.status') === sent,
        evaluated: counted.converts,
    }).toEqual({ adopted: true, evaluated: 1 })
})

// 41.10 — A MISMATCH IN A BODY THE SERVER PAINTED WARNS, on `abide:hydrate`, and is rebuilt. The first
// run no longer guesses which arm it is standing on, so it has no reason to hydrate quietly. THE
// REVERT: the guess — a mount that throws on any disagreement, caught bare and refilled — rebuilds the
// body in silence.
test('a mismatch in a server-painted body warns — 41.10', async () => {
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    try {
        await served(pageWith('1.09'), () => {
            const converted = document.getElementById('converted') as Element
            converted.replaceWith(document.createElement('em'))
        })
        expect(document.getElementById('converted')?.textContent).toBe(
            '$1351.60',
        )
    } finally {
        console.warn = warn
    }
    expect(warned.filter((line) => line.includes('abide:hydrate')).length).toBe(
        1,
    )
})

// A BODY THAT FAILED ON THE SERVER AND SUCCEEDS IN THE BROWSER is filled, not left in its catch: the
// caught anchor has the body tried behind the catch, which is what finds that out, and it is not a
// mismatch. THE REVERT: hydrate the body over a caught anchor as over a plain one (no `mountBehind`); the
// body is walked over the catch, which 41.10 rebuilds — right in the end, and a warning about a
// disagreement there was not.
test('a body that only failed on the server is filled on the client, quietly — 32.16', async () => {
    const flagged = globalThis as { serverOnly?: boolean }
    flagged.serverOnly = true
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    await served(
        pageWith('1.09').replace(
            'const value = Number(typed)',
            "if ((globalThis as { serverOnly?: boolean }).serverOnly) throw new Error('server only')\n    const value = Number(typed)",
        ),
        () => {
            expect(document.querySelector('.status')?.textContent).toBe(
                'server only',
            )
            flagged.serverOnly = false
        },
    ).finally(() => {
        console.warn = warn
    })
    expect(document.getElementById('converted')?.textContent).toBe('$1351.60')
    expect(document.querySelector('.status')).toBeNull()
    expect(warned.filter((line) => line.includes('abide:hydrate'))).toEqual([])
})

// A page and the component files it imports, compiled as the build compiles them and served; the
// mount is handed back unrun, so a test can count what hydrating does.
async function servedWith(
    page: string,
    components: Record<string, string>,
): Promise<() => void> {
    const modules: Record<string, string> = {}
    for (const [name, source] of Object.entries({
        ...components,
        Page: page,
    })) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        modules[`${name}.ts`] = emitComponent(file, reads)
        modules[`${name}.client.ts`] =
            emitClient(file, reads, name === 'Page' ? 'none' : 'invoked') ||
            'export default () => {}'
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
        html.indexOf('<body>') + 6,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    // The parser's one template, made before anything is counted.
    markupNodes(document, '')
    return () => {
        mount(pageRegion(document.body))
        flushSync()
    }
}

// A component that throws as it is set up, unless told to succeed.
const FAILING = `<script>
if (!(globalThis as { childSucceeds?: boolean }).childSucceeds) throw new Error('child failed')
</script>
<b class="child">child</b>`
const succeeds = globalThis as { childSucceeds?: boolean }

const CATCH = `{:catch problem}<p class="status">{problem.message}</p>{/try}`

// One body, three places a component in it can fail — a file component's setup, an inline
// component's template, a file component's setup two levels down — and the nodes hydrating the
// server's catch creates.
const FAILING_PAGES: [string, string, Record<string, string>, number][] = [
    [
        'a file component',
        `<script>
import Child from './Child.abide'
</script>
{#try}<Child/>${CATCH}`,
        { Child: FAILING },
        2,
    ],
    [
        'an inline component',
        `<script>
function fail(): string {
    if (!(globalThis as { childSucceeds?: boolean }).childSucceeds) throw new Error('child failed')
    return 'child'
}
</script>
{#component Child()}<b class="child">{fail()}</b>{/component}
{#try}<Child/>${CATCH}`,
        {},
        4,
    ],
    [
        'a component two levels down',
        `<script>
import Middle from './Middle.abide'
</script>
{#try}<Middle/>${CATCH}`,
        {
            Child: FAILING,
            Middle: `<script>
import Child from './Child.abide'
</script>
<i class="middle"><Child/></i>`,
        },
        5,
    ],
]

// 32.16 AND 41.10 — A COMPONENT THAT THROWS IN A `{#try}` BODY IS NOT FOUND BY BUILDING THE BODY: the
// build writes the component as an empty anchor pair, and the component runs when the body mounts.
// So where the server painted the catch, the body is tried BEHIND it (`TryRegion.mountBehind`), and a
// body that fails there too leaves the catch the server sent — adopted, not rebuilt. What is still
// created is the body's own nodes up to the component that throws, which is where a component runs —
// once, by the retry's first run (`TryRegion.follow`). THE REVERT: empty the
// caught region once the body's build succeeds (the first run's `fillRegion`, as it was); the body
// is built into the page, fails as it mounts, and the catch is built again — a node the server never
// sent, with 8, 8 and 11 nodes created.
for (const [what, page, components, created] of FAILING_PAGES)
    test(`a server-painted catch over ${what} that throws is adopted — 32.16, 41.10`, async () => {
        succeeds.childSucceeds = false
        const mount = await servedWith(page, components)
        const sent = document.querySelector('.status')
        expect(sent?.textContent).toBe('child failed')
        const work = measure(mount)
        expect({
            adopted: document.querySelector('.status') === sent,
            body: document.querySelector('.child, .middle'),
            created: work.nodesCreated,
        }).toEqual({ adopted: true, body: null, created })
    })

// A BODY THAT ONLY FAILED ON THE SERVER, with a component in it, is built ONCE: behind the catch, and
// kept. Four nodes — the component's anchor pair and its `<b>` and text — and the catch's leave.
// THE REVERT: evaluate the caught body in the first run by building it, as it was; that build is
// thrown away and 6 are created.
test('a caught body that succeeds in the browser is built once — 32.16', async () => {
    succeeds.childSucceeds = false
    const [, page, components] = FAILING_PAGES[0] as (typeof FAILING_PAGES)[0]
    const mount = await servedWith(page, components)
    succeeds.childSucceeds = true
    const work = measure(mount)
    expect({
        body: document.querySelector('.child')?.textContent,
        caught: document.querySelector('.status'),
        created: work.nodesCreated,
    }).toEqual({ body: 'child', caught: null, created: 4 })
})

// 32.16 — A BODY THE SERVER RENDERED WHOLE is adopted with nothing made, and where its component
// throws in the browser instead, the catch replaces the whole body.
test('a server-painted body is adopted, or replaced where its component throws in the browser — 32.16', async () => {
    const [, page, components] = FAILING_PAGES[0] as (typeof FAILING_PAGES)[0]
    succeeds.childSucceeds = true
    const adopted = await servedWith(page, components)
    const sent = document.querySelector('.child')
    expect(measure(adopted).nodesCreated).toBe(0)
    expect(document.querySelector('.child')).toBe(sent)

    const replaced = await servedWith(page, components)
    succeeds.childSucceeds = false
    replaced()
    expect(document.querySelector('.child')).toBeNull()
    expect(document.querySelector('.status')?.textContent).toBe('child failed')
})

// A component that throws as it is set up while its `ok` prop is false.
const GATED = `<script>
import { props } from 'abide'

const { ok } = props<{ ok: boolean }>()
if (!ok) throw new Error('child failed')
</script>
<b class="child">child</b>`

// A page whose button fixes what the component reads, starting from what `childSucceeds` says —
// on the server and again in the browser, so the two can disagree.
const gatedPage = (invoked: string, imported: string) => `<script>
import { reactive } from 'abide'
import ${imported} from './${imported}.abide'

let ok = reactive(Boolean((globalThis as { childSucceeds?: boolean }).childSucceeds))
</script>
<button onclick={() => { ok = true }}>fix</button>
{#try}${invoked}${CATCH}`

const GATED_PAGES: [string, string, Record<string, string>, number][] = [
    [
        'a file component',
        gatedPage('<Child ok={ok}/>', 'Child'),
        { Child: GATED },
        4,
    ],
    [
        'a component two levels down',
        gatedPage('<Middle ok={ok}/>', 'Middle'),
        {
            Child: GATED,
            Middle: `<script>
import { props } from 'abide'
import Child from './Child.abide'

const { ok } = props<{ ok: boolean }>()
</script>
<i class="middle"><Child ok={ok}/></i>`,
        },
        7,
    ],
]

const fix = (): void => {
    ;(document.querySelector('button') as HTMLElement).click()
    flushSync()
}

// 32.16 — A CATCH A COMPONENT RAISED RECOVERS when what the component read is fixed: the retry mounts
// the body behind the catch (`TryRegion.remount`), so it sees a component's failure — and what
// the component read — as the mount does, and the body that mounts is the one kept: built once, the
// count in `GATED_PAGES`. Whether the server painted the catch or the browser raised it. THE
// REVERT: retry by building the body, as it was; the build writes the component as an empty pair,
// sees nothing fail and reads nothing, so the fix wakes nothing and the catch stays.
for (const [what, page, components, created] of GATED_PAGES)
    for (const where of ['on the server', 'in the browser'])
        test(`a catch raised by ${what} ${where} recovers when it is fixed — 32.16`, async () => {
            succeeds.childSucceeds = where === 'in the browser'
            const mount = await servedWith(page, components)
            succeeds.childSucceeds = false
            mount()
            expect(document.querySelector('.status')?.textContent).toBe(
                'child failed',
            )
            const work = measure(fix)
            expect({
                body: document.querySelector('.child')?.textContent,
                caught: document.querySelector('.status') !== null,
                created: work.nodesCreated,
            }).toEqual({ body: 'child', caught: false, created })
        })
