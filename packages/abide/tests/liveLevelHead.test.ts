// 39.4, 39.13 — A LIVE HEAD RE-APPLIED IS STILL MERGED BY DEPTH. A level whose `<head>` reads a
// value writes it again when the value moves, and what it writes must not undo a deeper
// contributor's key: a component mounted in the level, or a level mounted below it.

import { afterAll, expect, test } from 'bun:test'

import { emitClient, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { flushSync } from '#shared'
import { REGION_CLOSE, REGION_OPEN } from '#shared/ANCHORS.ts'
import { CURRENT_ROUTER } from '#shared/CURRENT_ROUTER.ts'
import { type PageMount, startRouter } from '#ui/routing.ts'

import { servedModules } from './servedModules.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)
const unstubbed = globalThis.fetch
globalThis.fetch = (async (input: URL | string) =>
    Object.defineProperty(new Response(null, { status: 204 }), 'url', {
        value: new URL(String(input)).href,
    })) as typeof fetch
afterAll(async () => {
    await session.close()
    removeTemporaryModules()
    CURRENT_ROUTER.current = null
    globalThis.fetch = unstubbed
})

// The level's own value, handed out so a test can move it.
const TICKS = `import { reactive } from '@abide/abide'

const tick = reactive(0)
;(globalThis as { setTick?: (value: number) => void }).setTick = (value) => tick.set(value)`
const setTick = (value: number): void =>
    (globalThis as { setTick?: (value: number) => void }).setTick?.(value)
const EMPTY: PageMount = (region) => {
    void region
    return { stop() {} } as ReturnType<PageMount>
}

/** A router over `/at` — `page` under `layout` — with `/` standing first, navigated to `/at`. */
async function arrive(
    layout: string,
    page: string,
    components: Record<string, string> = {},
): Promise<void> {
    history.replaceState(null, '', '/')
    document.head.innerHTML = '<title>Home</title>'
    document.body.innerHTML = `<!--${REGION_OPEN}--><!--${REGION_CLOSE}-->`
    const files: Record<
        string,
        { server: string; client: string; source?: string }
    > = {}
    const compiled: [string, string, 'routed' | 'invoked'][] = [
        ['Layout', layout, 'routed'],
        ['Page', page, 'routed'],
    ]
    for (const [name, source] of Object.entries(components))
        compiled.push([name, source, 'invoked'])
    for (const [name, source, fill] of compiled) {
        const file = parseAbide(source)
        files[`${name}.abide`] = {
            server: '',
            client: emitClient(
                file,
                await session.reads(`${ROOT}src/${name}.abide`, file),
                fill,
            ),
        }
    }
    const dir = servedModules(files)
    const r = startRouter(
        [
            {
                pattern: '/at',
                load: () => import(`${dir}/Page.abide?client`),
                layouts: [() => import(`${dir}/Layout.abide?client`)],
            },
            {
                pattern: '/',
                load: async () => ({ default: EMPTY }),
                layouts: [],
            },
        ],
        document.body,
    )
    await r.go('/at')
    flushSync()
}

// NOT A REGRESSION GATE FOR A BUG THAT SHIPPED: `followHead` is the last unit of the level's markup,
// so every component in it has contributed before its first run. THE REVERT: leave the level's own
// contributions out of what `Level.headsAfter` answers below it; a tick writes `Layout 1` over
// `Framed`.
test("a live layout head keeps its component's deeper key — 39.4, 39.13", async () => {
    await arrive(
        `<head><title>Layout {tick}</title></head>
<script>
${TICKS}
import Frame from './Frame.abide'
</script>
<Frame><slot/></Frame>`,
        '<main id="page">page</main>',
        { Frame: '<head><title>Framed</title></head><div><slot/></div>' },
    )
    expect(document.title).toBe('Framed')
    setTick(1)
    flushSync()
    expect(document.title).toBe('Framed')
})

// THE REVERT: drop the `deeper` skip from `applyHead`; the page's `Page` loses to `Layout 1`.
test('a live layout head keeps the page below it — 39.4, 39.13', async () => {
    await arrive(
        `<head><title>Layout {tick}</title><meta name="description" content="d{tick}"></head>
<script>
${TICKS}
</script>
<slot/>`,
        '<head><title>Page</title></head><main id="page">page</main>',
    )
    expect(document.title).toBe('Page')
    setTick(1)
    flushSync()
    expect(document.title).toBe('Page')
    // What only the live level keys still follows.
    expect(
        document.head
            .querySelector('meta[name="description"]')
            ?.getAttribute('content'),
    ).toBe('d1')
})

// 39.13, 39.15 — A RE-APPLIED HEAD REPLACES WHAT ITS CONTRIBUTOR WROTE LAST, keyless nodes included.
// A keyless node cannot replace by key, so a head written again on every change appended its
// `<meta charset>` once a change and its moving keyless `<meta>` beside the one before it.
//
// THE REVERT: drop `last` from `Level.reapply`'s `applyHead` call; two ticks leave three
// `<meta charset>`s where one is due.
test('a live level head replaces its own keyless nodes rather than adding beside them — 39.13, 39.15', async () => {
    await arrive(
        `<head><title>Layout {tick}</title><meta charset="utf-8"><meta http-equiv="x-tick" content="t{tick}"></head>
<script>
${TICKS}
</script>
<slot/>`,
        '<main id="page">page</main>',
    )
    setTick(1)
    flushSync()
    setTick(2)
    flushSync()
    expect(document.title).toBe('Layout 2')
    expect(document.head.querySelectorAll('meta[charset]')).toHaveLength(1)
    const ticks = document.head.querySelectorAll('meta[http-equiv="x-tick"]')
    expect(ticks).toHaveLength(1)
    expect(ticks[0]?.getAttribute('content')).toBe('t2')
})

// 39.13 — A COMPONENT'S LIVE HEAD FOLLOWS ITS VALUE as its page's does, still yields to what is
// deeper (39.4), and replaces its own keyless nodes (39.15).
//
// THE REVERT: read the head once in `Level.contribute` in place of opening its watch;
// the title stays `Framed 0`. Keep the watch and drop `last` from `Level.reapply`, and the `x-tick`s
// number 3.
test("a component's live head follows its value — 39.13", async () => {
    await arrive(
        '<slot/>',
        `<head><title>Page</title></head>
<script>
import Frame from './Frame.abide'
</script>
<Frame/>`,
        {
            Frame: `<head><title>Framed {tick}</title><meta http-equiv="x-tick" content="t{tick}"></head>
<script>
${TICKS}
</script>
<p>frame {tick}</p>`,
        },
    )
    expect(document.title).toBe('Framed 0')
    setTick(1)
    flushSync()
    setTick(2)
    flushSync()
    expect(document.title).toBe('Framed 2')
    const ticks = document.head.querySelectorAll('meta[http-equiv="x-tick"]')
    expect(ticks).toHaveLength(1)
    expect(ticks[0]?.getAttribute('content')).toBe('t2')
})

// 39.4 — A COMPONENT'S LIVE HEAD IN A LAYOUT STILL YIELDS TO THE PAGE BELOW IT.
//
// THE REVERT: leave the levels below out of what `Level.headsAfter` answers; a tick writes
// `Framed 1` over `Page`. Apply `Level.mount`'s components with no `below`, and the layout's
// `Framed 0` lands over the page's title before any tick.
test("a component's live head in a layout keeps the page below it — 39.4, 39.13", async () => {
    await arrive(
        `<script>
import Frame from './Frame.abide'
</script>
<Frame/><slot/>`,
        '<head><title>Page</title></head><main id="page">page</main>',
        {
            Frame: `<head><title>Framed {tick}</title></head>
<script>
${TICKS}
</script>
<p>frame</p>`,
        },
    )
    expect(document.title).toBe('Page')
    setTick(1)
    flushSync()
    expect(document.title).toBe('Page')
})

// 39.14, 39.16 — A COMPONENT'S HEAD LEAVES WITH ITS REGION: an `{#if}` closing over it hands its key
// back to the page's and takes its keyless nodes with it, and a tick after writes nothing.
//
// THE REVERT: make `HeadContribution.stop` a no-op, or emit no `own` for it; the title stays
// `Framed 0` after the close. Drop the keyless removal from `withdrawHead`, and one `x-tick` stays.
test("a component's head is withdrawn with its region — 39.14, 39.16", async () => {
    await arrive(
        '<slot/>',
        `<head><title>Page</title></head>
<script>
import { reactive } from '@abide/abide'
import Frame from './Frame.abide'
let shown = reactive(true)
;(globalThis as { hide?: () => void }).hide = () => shown.set(false)
</script>
{#if shown}<Frame/>{/if}`,
        {
            Frame: `<head><title>Framed {tick}</title><meta http-equiv="x-tick" content="t{tick}"></head>
<script>
${TICKS}
</script>
<p>frame</p>`,
        },
    )
    expect(document.title).toBe('Framed 0')
    ;(globalThis as { hide?: () => void }).hide?.()
    flushSync()
    expect(document.title).toBe('Page')
    expect(
        document.head.querySelectorAll('meta[http-equiv="x-tick"]'),
    ).toHaveLength(0)
    setTick(1)
    flushSync()
    expect(document.title).toBe('Page')
})

// 39.14 — A KEY A LIVE HEAD STOPS WRITING IS WITHDRAWN as a leaving contributor's is: back to the
// nearest outer contributor's value, or removed where none has the key.
//
// THE REVERT: skip the withdrawal at the end of `applyHead` (`restoreKeys`); `k0` stays the page's.
test('a live head whose key moves withdraws the key it left — 39.13, 39.14', async () => {
    await arrive(
        '<head><meta name="k0" content="layout"></head><slot/>',
        `<head><meta name="k{tick}" content="page"></head>
<script>
${TICKS}
</script>
<main id="page">page</main>`,
    )
    const content = (name: string): (string | null)[] =>
        [...document.head.querySelectorAll(`meta[name="${name}"]`)].map(
            (meta) => meta.getAttribute('content'),
        )
    expect(content('k0')).toEqual(['page'])
    setTick(1)
    flushSync()
    expect(content('k0')).toEqual(['layout'])
    expect(content('k1')).toEqual(['page'])
    setTick(2)
    flushSync()
    expect(content('k1')).toEqual([])
    expect(content('k2')).toEqual(['page'])
})

// 39.13 — A COMPONENT MOUNTED AFTER ITS LEVEL CONTRIBUTES THEN: an `{#if}` opening over it titles the
// document, its live head follows, and it leaves with the arm.
//
// THE REVERT: contribute only while the level mounts (`unapplied !== undefined` in
// `contributeHead`); the title stays `Page`.
test('a component mounted after its level contributes its head then — 39.13, 39.14', async () => {
    await arrive(
        '<slot/>',
        `<head><title>Page</title></head>
<script>
import { reactive } from '@abide/abide'
import Frame from './Frame.abide'
let shown = reactive(false)
;(globalThis as { show?: (value: boolean) => void }).show = (value) => shown.set(value)
</script>
{#if shown}<Frame/>{/if}`,
        {
            Frame: `<head><title>Framed {tick}</title></head>
<script>
${TICKS}
</script>
<p>frame</p>`,
        },
    )
    const show = (value: boolean): void =>
        (globalThis as { show?: (value: boolean) => void }).show?.(value)
    expect(document.title).toBe('Page')
    show(true)
    flushSync()
    expect(document.title).toBe('Framed 0')
    setTick(1)
    flushSync()
    expect(document.title).toBe('Framed 1')
    show(false)
    flushSync()
    expect(document.title).toBe('Page')
})

// 39.13, 39.16 — A ROW THE LIST GREW BY CONTRIBUTES, and a row removed takes its keyless node.
//
// THE REVERT: as above; no `x-row` is ever written, `[]` where `['a', 'b']` is due. Drop the
// immediate `applyHead` from `Level.contribute`, and the same.
test('a row grown after its level contributes its head, and leaves with it — 39.13, 39.16', async () => {
    await arrive(
        '<slot/>',
        `<script>
import { reactive } from '@abide/abide'
import Row from './Row.abide'
let names = reactive<string[]>([])
;(globalThis as { rows?: (value: string[]) => void }).rows = (value) => names.set(value)
</script>
<ul>{#for name of names}<Row name={name}/>{/for}</ul>`,
        {
            Row: `<head><meta http-equiv="x-row" content={name}></head>
<script>
import { props } from '@abide/abide'
const { name } = props<{ name: string }>()
</script>
<li>{name}</li>`,
        },
    )
    const rows = (value: string[]): void =>
        (globalThis as { rows?: (value: string[]) => void }).rows?.(value)
    // In the order the rows mounted, which a list grown at once need not make the tree's (39.5).
    const contents = (): (string | null)[] =>
        [...document.head.querySelectorAll('meta[http-equiv="x-row"]')]
            .map((meta) => meta.getAttribute('content'))
            .sort()
    rows(['a', 'b'])
    flushSync()
    expect(contents()).toEqual(['a', 'b'])
    rows(['a'])
    flushSync()
    expect(contents()).toEqual(['a'])
})

// 39.14, 39.16 — A PAGE LEAVES WITH ITS LAYOUT'S `<slot/>`, AND ITS HEAD WITH IT. A slot standing
// in a `{#if}` that closes takes the page below it out of the document; what the page keyed goes
// back to the layout's, and what it wrote without a key leaves. The slot opening again mounts the
// page, and its head with it.
//
// THE REVERT: drop the two reconciles from `Router.release`. The page's title outlives it — this
// reports `Page` where `Layout` is due — and so does its keyless `<meta>`.
test("a page's head leaves with its layout's slot — 39.14, 39.16", async () => {
    await arrive(
        `<script>
import { reactive } from '@abide/abide'

let open = reactive(true)
;(globalThis as { setOpen?: (value: boolean) => void }).setOpen = (value) => { open = value }
</script>

<head><title>Layout</title></head>
<div>{#if open}<slot/>{/if}</div>`,
        `<head><title>Page</title><meta http-equiv="x-page" content="p"></head>
<main>page</main>`,
    )
    const setOpen = (value: boolean): void => {
        ;(globalThis as { setOpen?: (value: boolean) => void }).setOpen?.(value)
        flushSync()
    }
    const keyless = () =>
        document.head.querySelectorAll('meta[http-equiv="x-page"]').length
    expect(document.title).toBe('Page')
    expect(keyless()).toBe(1)
    setOpen(false)
    expect(document.title).toBe('Layout')
    expect(keyless()).toBe(0)
    setOpen(true)
    expect(document.title).toBe('Page')
    expect(keyless()).toBe(1)
})
