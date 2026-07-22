// compose() chain handle (C6.2 nav persistence) — the linchpin: mounting a [layout, page] chain exposes
// a per-level `records` array whose suffix disposer tears down ONLY the page, leaving the layout's DOM
// node identity (and thus its `<script>` state cell) untouched. This is the keep-alive primitive a
// same-chain soft-nav rides: dispose the diverging suffix, keep the shared prefix.

import { describe, expect, test } from 'bun:test'
import { state } from '../../shared/state.ts'
import { compose } from './compose.ts'
import { type ComponentResolver, loadEmitted } from './emit.ts'

// A layout with a `<script>` state cell rendered into the DOM + a `<slot/>` outlet for its child.
const LAYOUT =
    `<script>import { state } from "abide/shared/state"; let n = state(7)</script>` +
    `<div data-testid="layout"><b data-testid="n">{n}</b><slot/></div>`

const PAGE = `<p data-testid="page">page body</p>`

const resolve: ComponentResolver = () => undefined

describe('compose() chain handle', () => {
    test('mount exposes a per-level records array (root + suffix)', async () => {
        const layout = await loadEmitted(LAYOUT, resolve)
        const page = await loadEmitted(PAGE, resolve)
        const host = document.createElement('div')

        const handle = compose([layout, page]).mount(host, { state })

        // Whole chain rendered: the layout frame wraps the page, and the layout's state landed.
        expect(host.querySelector('[data-testid="layout"]')).not.toBeNull()
        expect(host.querySelector('[data-testid="n"]')?.textContent).toBe('7')
        expect(host.querySelector('[data-testid="page"]')).not.toBeNull()

        // One record per level, index-aligned. The suffix (page) carries its outlet marker.
        expect(handle.records.length).toBe(2)
        expect(handle.records[0]?.index).toBe(0)
        expect(handle.records[1]?.index).toBe(1)
        expect(handle.records[1]?.marker).not.toBeNull()
        expect(typeof handle.records[1]?.dispose).toBe('function')
    })

    test('disposing the suffix keeps the prefix alive (same node identity + state)', async () => {
        const layout = await loadEmitted(LAYOUT, resolve)
        const page = await loadEmitted(PAGE, resolve)
        const host = document.createElement('div')

        const handle = compose([layout, page]).mount(host, { state })

        const layoutNode = host.querySelector('[data-testid="layout"]')
        const stateNode = host.querySelector('[data-testid="n"]')
        expect(layoutNode).not.toBeNull()

        // Tear down ONLY the diverging suffix (the page).
        handle.records[1]?.dispose()

        // The page is gone…
        expect(host.querySelector('[data-testid="page"]')).toBeNull()
        // …but the layout is the SAME live node (never rebuilt) and its state cell survived.
        expect(host.querySelector('[data-testid="layout"]')).toBe(layoutNode)
        expect(host.querySelector('[data-testid="n"]')).toBe(stateNode)
        expect(host.querySelector('[data-testid="n"]')?.textContent).toBe('7')
    })

    test('remount claim-grafts a fresh suffix into the kept layout outlet', async () => {
        const layout = await loadEmitted(LAYOUT, resolve)
        const pageA = await loadEmitted(`<p data-testid="page">page A</p>`, resolve)
        const pageB = await loadEmitted(`<p data-testid="page">page B</p>`, resolve)
        const host = document.createElement('div')

        const handle = compose([layout, pageA]).mount(host, { state })
        const layoutNode = host.querySelector('[data-testid="layout"]')
        const stateNode = host.querySelector('[data-testid="n"]')
        expect(host.querySelector('[data-testid="page"]')?.textContent).toBe('page A')

        // Swap the suffix for pageB, claiming its SSR HTML. The `data-graft` attribute is NOT in pageB's
        // template — if it survives, the grafted node was ADOPTED (claimed), not freshly cloned.
        handle.records[1]?.remount?.(
            [layout, pageB],
            { state },
            `<p data-testid="page" data-graft="yes">page B</p>`,
        )

        // The kept layout is the SAME live node with its state intact.
        expect(host.querySelector('[data-testid="layout"]')).toBe(layoutNode)
        expect(host.querySelector('[data-testid="n"]')).toBe(stateNode)
        expect(host.querySelector('[data-testid="n"]')?.textContent).toBe('7')

        // The new suffix is present, CLAIMED (adopted the grafted node), and pageA is gone.
        const page = host.querySelector('[data-testid="page"]')
        expect(host.querySelectorAll('[data-testid="page"]').length).toBe(1)
        expect(page?.textContent).toBe('page B')
        expect(page?.getAttribute('data-graft')).toBe('yes')

        // A whole-chain dispose tears the NEW suffix (the kept parent's teardown pointer tracked the swap).
        handle()
        expect(host.querySelector('[data-testid="layout"]')).toBeNull()
        expect(host.querySelector('[data-testid="page"]')).toBeNull()
    })

    test('the handle is a callable that disposes the whole chain (back-compat)', async () => {
        const layout = await loadEmitted(LAYOUT, resolve)
        const page = await loadEmitted(PAGE, resolve)
        const host = document.createElement('div')

        const handle = compose([layout, page]).mount(host, { state })
        expect(host.querySelector('[data-testid="layout"]')).not.toBeNull()

        handle()

        expect(host.querySelector('[data-testid="layout"]')).toBeNull()
        expect(host.querySelector('[data-testid="page"]')).toBeNull()
    })
})
