// reactive/dynamic component names — `<C/>` where `const C = memo(() => done ? Done : Pending)`. The
// selected components must be SCRIPT-scoped (imports/props), since the binding lives in the `<script>`.
// Proves SSR renders the current branch, and flipping the state swaps the mounted one — and that
// reactive-component detection keys on MEMOS as well as cells (ADR 0024).

import { describe, expect, test } from 'bun:test'
import { state } from '../../shared/state.ts'
import { type ComponentResolver, loadEmitted } from './emit.ts'

function tick(): Promise<void> {
    return Promise.resolve()
}

function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}

const PENDING = `<span data-testid="p">pending</span>`
const DONE = `<span data-testid="d">done</span>`

const PAGE =
    `<script>` +
    `import { state } from "abide/shared/state"; ` +
    `import { memo } from "abide/shared/memo"; ` +
    `import Pending from "./Pending.abide"; ` +
    `import Done from "./Done.abide"; ` +
    `let done = state(false); ` +
    `const Current = memo(() => done ? Done : Pending)` +
    `</script>` +
    `<div><Current/></div>` +
    `<button onclick={() => done = true}>finish</button>`

const resolve: ComponentResolver = (s) =>
    s === './Pending.abide' ? PENDING : s === './Done.abide' ? DONE : undefined

describe('reactive component name', () => {
    test('server renders the current branch (done=false → Pending)', async () => {
        const emitted = await loadEmitted(PAGE, resolve)
        const html = await emitted.render({ state })
        expect(stripAnchors(html)).toContain('pending')
        expect(stripAnchors(html)).not.toContain('>done<')
    })

    test('client mount + flipping the cell swaps the mounted component', async () => {
        const emitted = await loadEmitted(PAGE, resolve)
        const host = document.createElement('div')
        emitted.mount(host, { state })

        expect(host.querySelector('[data-testid="p"]')).not.toBeNull()
        expect(host.querySelector('[data-testid="d"]')).toBeNull()

        const button = host.querySelector('button')
        if (button === null) throw new Error('expected a button')
        button.click()
        await tick()

        expect(host.querySelector('[data-testid="p"]')).toBeNull()
        expect(host.querySelector('[data-testid="d"]')).not.toBeNull()
    })

    test('hydrate over SSR then flip the cell swaps the component (the docs demo path)', async () => {
        const emitted = await loadEmitted(PAGE, resolve)
        const host = document.createElement('div')
        host.innerHTML = await emitted.render({ state })
        // SSR rendered the current branch (done=false → Pending).
        expect(host.querySelector('[data-testid="p"]')).not.toBeNull()
        expect(host.querySelector('[data-testid="d"]')).toBeNull()

        emitted.hydrate(host, { state })
        // Hydration claims the Pending branch (no double-render).
        expect(host.querySelectorAll('[data-testid="p"]').length).toBe(1)

        const button = host.querySelector('button')
        if (button === null) throw new Error('expected a button')
        button.click()
        await tick()

        expect(host.querySelector('[data-testid="p"]')).toBeNull()
        expect(host.querySelectorAll('[data-testid="d"]').length).toBe(1)
    })
})

// A MEMBER tag — `<item.Icon/>` — names the component held at that path. The head is an ordinary
// binding (a `{#for}` item, a cell), so the tag is an expression rather than an import and resolves
// reactively, like a cell-named tag.
const FOR_PAGE =
    `<script>` +
    `import Pending from "./Pending.abide"; ` +
    `import Done from "./Done.abide"; ` +
    `const items = [{ Icon: Pending }, { Icon: Done }]` +
    `</script>` +
    `{#for item of items}<item.Icon/>{/for}`

const CELL_PAGE =
    `<script>` +
    `import { state } from "abide/shared/state"; ` +
    `import Pending from "./Pending.abide"; ` +
    `import Done from "./Done.abide"; ` +
    `let box = state({ Icon: Pending })` +
    `</script>` +
    `<div><box.Icon/></div>` +
    `<button onclick={() => box = { Icon: Done }}>swap</button>`

describe('member component tag', () => {
    test('each `{#for}` item resolves its own component (server)', async () => {
        const emitted = await loadEmitted(FOR_PAGE, resolve)
        const html = stripAnchors(await emitted.render({ state }))
        expect(html).toContain('pending')
        expect(html).toContain('done')
    })

    test('each `{#for}` item resolves its own component (client)', async () => {
        const emitted = await loadEmitted(FOR_PAGE, resolve)
        const host = document.createElement('div')
        emitted.mount(host, { state })
        expect(host.querySelectorAll('[data-testid="p"]').length).toBe(1)
        expect(host.querySelectorAll('[data-testid="d"]').length).toBe(1)
    })

    test('hydrating a `{#for}` of member tags claims the SSR nodes (no double-render)', async () => {
        const emitted = await loadEmitted(FOR_PAGE, resolve)
        const host = document.createElement('div')
        host.innerHTML = await emitted.render({ state })
        emitted.hydrate(host, { state })
        expect(host.querySelectorAll('[data-testid="p"]').length).toBe(1)
        expect(host.querySelectorAll('[data-testid="d"]').length).toBe(1)
    })

    test('a cell head re-mounts the tag when the component behind it changes', async () => {
        const emitted = await loadEmitted(CELL_PAGE, resolve)
        const host = document.createElement('div')
        emitted.mount(host, { state })
        expect(host.querySelector('[data-testid="p"]')).not.toBeNull()

        const button = host.querySelector('button')
        if (button === null) throw new Error('expected a button')
        button.click()
        await tick()

        expect(host.querySelector('[data-testid="p"]')).toBeNull()
        expect(host.querySelectorAll('[data-testid="d"]').length).toBe(1)
    })
})
