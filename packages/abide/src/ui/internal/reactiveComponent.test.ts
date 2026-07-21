// reactive/dynamic component names — `<C/>` where `const C = state.computed(() => done ?
// Done : Pending)`. The selected components must be SCRIPT-scoped (imports/props), since a cell lives in
// the `<script>`. Proves SSR renders the current branch, and flipping the cell swaps the mounted one.

import { describe, expect, test } from 'bun:test'
import { state } from '../state.ts'
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
    `import { state } from "abide/ui/state"; ` +
    `import Pending from "./Pending.abide"; ` +
    `import Done from "./Done.abide"; ` +
    `let done = state(false); ` +
    `const Current = state.computed(() => done ? Done : Pending)` +
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
