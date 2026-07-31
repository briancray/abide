import { expect, test } from './fixtures.ts'
import { RENDER_BENCH_SCENARIOS } from './RENDER_BENCH_SCENARIOS.ts'
import { UPDATE_BENCH_SCENARIOS } from './UPDATE_BENCH_SCENARIOS.ts'

// The live in-browser mount/hydrate/update bench (`/platform/bench/client`) — the client counterpart to
// the SSR render bench. A `GET` AOT-compiles the corpus's client modules, `Bun.build`s them into ONE
// self-contained browser ES module, and server-renders each scenario's HTML; the page `blob:`-imports it
// and times four real DOM paths — `mount` (build from scratch), `unmount` (tear it back down) and
// `hydrate` (attach to the SSR markup) over the pure-render scenarios, and `update` (click a `<button>`,
// await the patch) over the interactive ones. This drives the real browser to prove the module instantiates, all passes measure, and —
// critically — that the reactive update scenarios actually PATCH the DOM (the bundle's own `state`
// instance shares its runtime scheduler; the page's separate copy would silently fail to propagate).

// The server-renderable corpus drives the mount + unmount + hydrate passes; the interactive one drives
// the update pass.
const RENDER_SCENARIOS = RENDER_BENCH_SCENARIOS
const UPDATE_SCENARIOS = UPDATE_BENCH_SCENARIOS

// Four passes over a 27-scenario corpus, each scenario timed twice (abide, then its hand-written
// baseline) against a ≥100ms floor — and seven of the update scenarios drive 1000-row lists. That is
// comfortably past Playwright's 30s default, so the whole run gets its own budget.
test('run measures every scenario across all four hot paths', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/platform/bench/client')
    await expect(page.locator('h1')).toContainText('mount/update bench')

    // Nothing runs until asked — the tables show their placeholder.
    await expect(page.getByTestId('mount-table')).toContainText('Hit')
    await page.getByTestId('run').click()

    // Every pass lands its full, fixed corpus (the button re-enables only after the whole run).
    const mountRows = page.getByTestId('mount-row')
    const unmountRows = page.getByTestId('unmount-row')
    const hydrateRows = page.getByTestId('hydrate-row')
    const updateRows = page.getByTestId('update-row')
    await expect(mountRows).toHaveCount(RENDER_SCENARIOS.length, { timeout: 60_000 })
    await expect(unmountRows).toHaveCount(RENDER_SCENARIOS.length, { timeout: 60_000 })
    await expect(hydrateRows).toHaveCount(RENDER_SCENARIOS.length, { timeout: 60_000 })
    await expect(updateRows).toHaveCount(UPDATE_SCENARIOS.length, { timeout: 60_000 })
    // The button re-enables only after the WHOLE run, whose tail is now the first-load pass — it drains
    // the streaming `benchFrontend` rpc, so this one waits on a server render bench as well as the four
    // browser passes. The per-table budgets above bound one pass each; this bounds all of them plus that
    // drain, so it is the sibling test's 120s rather than their 60s.
    await expect(page.getByTestId('run')).toBeEnabled({ timeout: 120_000 })
    await expect(page.getByTestId('run')).toHaveText('Run browser bench')

    // No scenario threw (the failure banner never rendered).
    await expect(page.getByTestId('bench-failed')).toHaveCount(0)

    // Every mount/hydrate row carries a real timing figure; the list scenarios also report ns/row (the
    // em-dash placeholder elsewhere). Both prove the row payload decoded and a measurement landed, not
    // just a shell. Match the scenario CELL exactly so `for-list-100` doesn't also select the `…000`s.
    const timing = /\d+(\.\d+)?\s*(ns|µs|ms)/
    for (const name of RENDER_SCENARIOS) {
        const mountRow = mountRows.filter({ has: page.getByRole('cell', { name, exact: true }) })
        const unmountRow = unmountRows.filter({
            has: page.getByRole('cell', { name, exact: true }),
        })
        const hydrateRow = hydrateRows.filter({
            has: page.getByRole('cell', { name, exact: true }),
        })
        await expect(mountRow).toContainText(timing)
        await expect(unmountRow).toContainText(timing)
        await expect(hydrateRow).toContainText(timing)
    }
    await expect(
        mountRows.filter({ has: page.getByRole('cell', { name: 'for-list-10000', exact: true }) }),
    ).toContainText('µs')
    await expect(
        hydrateRows.filter({ has: page.getByRole('cell', { name: 'static-text', exact: true }) }),
    ).toContainText('—')

    // Every update row measured a reactive patch.
    for (const name of UPDATE_SCENARIOS) {
        const row = updateRows.filter({ has: page.getByRole('cell', { name, exact: true }) })
        await expect(row).toContainText(timing)
    }

    // The vanilla baseline ran too: mount and update each carry a hand-written figure AND the abide ÷
    // vanilla multiplier, in this same tab. A missing baseline (or one that failed to bundle) would leave
    // the em-dash placeholder, so asserting the ratio format is what proves both sides were measured.
    const ratio = /\d+\.\d{2}×/
    for (const name of RENDER_SCENARIOS) {
        const mountRow = mountRows.filter({ has: page.getByRole('cell', { name, exact: true }) })
        await expect(mountRow).toContainText(ratio)
    }
    for (const name of UPDATE_SCENARIOS) {
        const row = updateRows.filter({ has: page.getByRole('cell', { name, exact: true }) })
        await expect(row).toContainText(ratio)
    }
    // Hydrate has no framework-free equivalent — that table has no vanilla column at all.
    await expect(page.getByTestId('hydrate-table')).not.toContainText('vanilla')
})

// The two DERIVED tables. Neither times a new hot path: `build vs adopt` joins the mount and hydrate
// figures the passes above produced (plus the browser's parse of the served markup, which the hydrate
// clock deliberately excludes), and `first load` joins those to the server's own `render` bench, drained
// from the streaming rpc at the end of the run. They are where hydration gets a comparison at all — a
// whole PATH against a whole path — so what has to be asserted is that both ratio columns actually
// computed, on every scenario. A join that silently missed would leave an em-dash, not an error.
test('the derived tables join the passes into whole-path comparisons', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/platform/bench/client')
    await page.getByTestId('run').click()

    const buildAdoptRows = page.getByTestId('build-adopt-row')
    const firstLoadRows = page.getByTestId('first-load-row')
    await expect(buildAdoptRows).toHaveCount(RENDER_SCENARIOS.length, { timeout: 90_000 })
    // First load lands last: it waits on the whole in-tab run, then drains the server render bench.
    await expect(firstLoadRows).toHaveCount(RENDER_SCENARIOS.length, { timeout: 120_000 })
    await expect(page.getByTestId('bench-failed')).toHaveCount(0)

    const timing = /\d+(\.\d+)?\s*(ns|µs|ms)/
    const ratio = /\d+\.\d{2}×/
    for (const name of RENDER_SCENARIOS) {
        const cell = page.getByRole('cell', { name, exact: true })
        const buildAdopt = buildAdoptRows.filter({ has: cell })
        const firstLoad = firstLoadRows.filter({ has: cell })
        await expect(buildAdopt).toContainText(timing)
        await expect(firstLoad).toContainText(timing)
        // Both of build-vs-adopt's ratios: hydrate ÷ mount (abide against itself) and parse + hydrate ÷
        // the hand-written build. Two matches in one row is what proves the vanilla join landed too.
        expect(await buildAdopt.locator('td').filter({ hasText: ratio }).count()).toBe(2)
        await expect(firstLoad).toContainText(ratio)
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
            append: await drive('list-append-update', (h) =>
                String(h.querySelectorAll('li').length),
            ),
            reverse: await drive(
                'list-reverse-1000',
                (h) => h.querySelector('li')!.textContent ?? '',
            ),
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

// Both passes mount the corpus the same number of times; `unmount` differs only in WHICH half of the
// round it puts on the clock. That makes their wall times comparable — and it is exactly the property
// that broke: collecting a 100ms floor of TEARDOWN samples meant paying ~5× that in untimed mounts, so
// the unmount pass ran 4.7× the mount pass (20.5s of a 35.5s run) and the page appeared to grind to a
// halt partway through. Asserted as a RATIO so it holds on any machine, fast or slow.
test('the unmount pass does not outrun the mount pass — the untimed setup stays bounded', async ({
    page,
}) => {
    test.setTimeout(180_000)
    await page.goto('/platform/bench/client')
    await page.getByTestId('run').click()

    const started = Date.now()
    await expect(page.getByTestId('mount-row')).toHaveCount(RENDER_SCENARIOS.length, {
        timeout: 60_000,
    })
    const mountMs = Date.now() - started
    await expect(page.getByTestId('unmount-row')).toHaveCount(RENDER_SCENARIOS.length, {
        timeout: 60_000,
    })
    const unmountMs = Date.now() - started - mountMs

    expect(mountMs).toBeGreaterThan(0)
    expect(unmountMs).toBeLessThan(mountMs * 2.5)
})
