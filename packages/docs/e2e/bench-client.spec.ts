import { expect, test } from '@playwright/test'

// The live in-browser mount/hydrate/update bench (`/platform/bench/client`) — the client counterpart to
// the SSR render bench. A `GET` AOT-compiles the corpus's client modules, `Bun.build`s them into ONE
// self-contained browser ES module, and server-renders each scenario's HTML; the page `blob:`-imports it
// and times three real DOM paths — `mount` (build from scratch) and `hydrate` (attach to the SSR markup)
// over the pure-render scenarios, and `update` (click a `<button>`, await the patch) over the interactive
// ones. This drives the real browser to prove the module instantiates, all passes measure, and —
// critically — that the reactive update scenarios actually PATCH the DOM (the bundle's own `state`
// instance shares its runtime scheduler; the page's separate copy would silently fail to propagate).

const RENDER_SCENARIOS = [
    'static-text',
    'interpolation',
    'attributes',
    'if-else',
    'switch',
    'await-block',
    'for-list-100',
    'for-list-1000',
    'for-list-10000',
]
const UPDATE_SCENARIOS = ['state-update', 'list-append-update', 'list-reverse-1000', 'if-toggle']

test('run measures every scenario across all three hot paths', async ({ page }) => {
    await page.goto('/platform/bench/client')
    await expect(page.locator('h1')).toContainText('mount/update bench')

    // Nothing runs until asked — the tables show their placeholder.
    await expect(page.getByTestId('mount-table')).toContainText('Hit')
    await page.getByTestId('run').click()

    // Every pass lands its full, fixed corpus (the button re-enables only after the whole run).
    const mountRows = page.getByTestId('mount-row')
    const hydrateRows = page.getByTestId('hydrate-row')
    const updateRows = page.getByTestId('update-row')
    await expect(mountRows).toHaveCount(RENDER_SCENARIOS.length, { timeout: 60_000 })
    await expect(hydrateRows).toHaveCount(RENDER_SCENARIOS.length, { timeout: 60_000 })
    await expect(updateRows).toHaveCount(UPDATE_SCENARIOS.length, { timeout: 60_000 })
    await expect(page.getByTestId('run')).toBeEnabled({ timeout: 60_000 })
    await expect(page.getByTestId('run')).toHaveText('Run browser bench')

    // No scenario threw (the failure banner never rendered).
    await expect(page.getByTestId('bench-failed')).toHaveCount(0)

    // Every mount/hydrate row carries a real timing figure; the list scenarios also report ns/row (the
    // em-dash placeholder elsewhere). Both prove the row payload decoded and a measurement landed, not
    // just a shell. Match the scenario CELL exactly so `for-list-100` doesn't also select the `…000`s.
    const timing = /\d+(\.\d+)?\s*(ns|µs|ms)/
    for (const name of RENDER_SCENARIOS) {
        const mountRow = mountRows.filter({ has: page.getByRole('cell', { name, exact: true }) })
        const hydrateRow = hydrateRows.filter({ has: page.getByRole('cell', { name, exact: true }) })
        await expect(mountRow).toContainText(timing)
        await expect(hydrateRow).toContainText(timing)
    }
    await expect(mountRows.filter({ has: page.getByRole('cell', { name: 'for-list-10000', exact: true }) })).toContainText('µs')
    await expect(hydrateRows.filter({ has: page.getByRole('cell', { name: 'static-text', exact: true }) })).toContainText('—')

    // Every update row measured a reactive patch.
    for (const name of UPDATE_SCENARIOS) {
        const row = updateRows.filter({ has: page.getByRole('cell', { name, exact: true }) })
        await expect(row).toContainText(timing)
    }
})

test('the update scenarios genuinely patch the live DOM (reactivity propagates through the bundle)', async ({
    page,
}) => {
    // The load-bearing correctness check: a `<script>`'s `state` import compiles to a `$scope.state` read,
    // so the interactive scenarios must be fed the BUNDLE's own `state` (which shares its runtime
    // scheduler). Feed them that, mount each, click, and assert the DOM actually changed — a regression to
    // the page's separate `state` copy would leave these frozen with NO error, so only a live-DOM assertion
    // catches it. Run in-page against the same RPC the bench uses.
    await page.goto('/platform/bench/client')

    const result = await page.evaluate(async () => {
        const res = await fetch('/__abide/rpc/benchFrontendClient')
        const bundle = (await res.json()) as { js: string }
        const url = URL.createObjectURL(new Blob([bundle.js], { type: 'text/javascript' }))
        const mod = (await import(/* @vite-ignore */ url)) as {
            scenarios: Record<string, { mount: (host: Element, scope: unknown) => () => void }>
            state: unknown
            watch: unknown
        }
        URL.revokeObjectURL(url)
        const flush = () => Promise.resolve().then(() => Promise.resolve())
        const scope = () => ({ state: mod.state, watch: mod.watch })

        const drive = async (name: string, read: (h: HTMLElement) => string) => {
            const host = document.createElement('div')
            const cleanup = mod.scenarios[name]!.mount(host, scope())
            await flush()
            const before = read(host)
            host.querySelector('button')!.click()
            await flush()
            const after = read(host)
            cleanup()
            return { before, after }
        }

        return {
            state: await drive('state-update', (h) => h.querySelector('span')!.textContent ?? ''),
            append: await drive('list-append-update', (h) => String(h.querySelectorAll('li').length)),
            reverse: await drive('list-reverse-1000', (h) => h.querySelector('li')!.textContent ?? ''),
            toggle: await drive('if-toggle', (h) => h.querySelector('p')!.textContent ?? ''),
        }
    })

    expect(result.state).toEqual({ before: '0', after: '1' })
    expect(result.append).toEqual({ before: '1', after: '2' })
    expect(result.reverse).toEqual({ before: '0', after: '999' })
    expect(result.toggle).toEqual({ before: 'A', after: 'B' })
})

test('hydrate adopts the server-rendered HTML in place (no duplication)', async ({ page }) => {
    // The hydrate pass replays each scenario's SSR markup. Prove `hydrate` ADOPTS the existing nodes
    // rather than rebuilding: a list must end with exactly its server rows (a mount-instead-of-hydrate
    // regression would double them), and the shipped HTML must carry hydration anchors for the walk.
    await page.goto('/platform/bench/client')

    const result = await page.evaluate(async () => {
        const res = await fetch('/__abide/rpc/benchFrontendClient')
        const bundle = (await res.json()) as {
            js: string
            scenarios: { name: string; html: string | null }[]
        }
        const html = Object.fromEntries(bundle.scenarios.map((s) => [s.name, s.html]))
        const url = URL.createObjectURL(new Blob([bundle.js], { type: 'text/javascript' }))
        const mod = (await import(/* @vite-ignore */ url)) as {
            scenarios: Record<string, { hydrate: (host: Element, scope: unknown) => () => void }>
        }
        URL.revokeObjectURL(url)

        const host = document.createElement('div')
        host.innerHTML = html['for-list-100']!
        const before = host.querySelectorAll('li').length
        const cleanup = mod.scenarios['for-list-100']!.hydrate(host, {
            items: Array.from({ length: 100 }, (_, i) => i),
        })
        const after = host.querySelectorAll('li').length
        cleanup()
        return { before, after, hasAnchor: html['for-list-100']!.includes('<!--[-->') }
    })

    expect(result.hasAnchor).toBe(true)
    expect(result.before).toBe(100)
    expect(result.after).toBe(100)
})
