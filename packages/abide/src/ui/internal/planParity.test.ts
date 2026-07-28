// SERVER↔CLIENT PLAN PARITY — the anchor contract, asserted.
//
// `templatePlan` decides every comment anchor ONCE so that `emitServer` (which writes them into an HTML
// string) and `emitClient` (which walks past them with a cursor) cannot disagree. Three separate
// comments in this directory state that as the load-bearing invariant — `templatePlan.ts` ("so the
// emitted client and server modules can never drift"), `emitServer.ts` ("Reads from the SAME plan the
// client emitter uses, so comment anchors match"), and `emitServer.genChunk` ("Anchors match the client
// by construction"). Nothing asserted it. The four biggest files behind it (`templatePlan`,
// `emitServer`, `emitClient`, `runtime`, ~4300 loc between them) had no test file at all, and `buildPlan`
// was reachable from tests only as a side effect of `emitModuleSource`.
//
// The gap is specifically a HYDRATE gap. `emit.oracle.test.ts` drives the whole 100-odd fixture corpus,
// but only through `render()` and `mount()` — the two paths that each build a DOM from scratch and can
// therefore agree perfectly while the third path is broken. An anchor mismatch does not corrupt either
// of them: the server's HTML is still right, a fresh mount is still right, and only the CLAIM walk —
// which reads the server's markers to find its way — goes wrong. When it does it is silent by design
// (`hydrate` falls back to a fresh mount rather than throwing), so the failure surfaces as a page that
// re-paints and loses its SSR nodes, not as a test failure.
//
// So this file asserts the property the prose claims, over the same corpus: for every fixture, the DOM
// after `render()` → `hydrate()` must equal the DOM after a from-scratch `mount()`. That is the one
// statement that is false whenever an anchor moves on one side only.
//
// Comparison is on `innerHTML` with the comment anchors normalised OUT: their POSITIONS are what the
// walk depends on, but a claimed region legitimately keeps the exact marker text the server wrote while
// a mounted one carries the skeleton's, and a `{#await}`/`{#for}` re-render legitimately leaves a
// different count of empty markers behind. What must match is the rendered CONTENT — text, elements,
// attributes — because that is what a reader sees when hydration silently re-paints.
//
// It found one on its first run: `{#try}` whose body throws rendered its `:catch` branch TWICE on
// hydrate (`caught:nope` + `nope`). See `hydrationTryDuplication` below for the mechanism and the fix.
//
// COVERAGE: the corpus is 101 fixtures. 27 declare `server: false` or `client: false` (one-sided by
// construction — event handlers, binds, server-only components) and 2 are `throws` fixtures, so 68
// fixtures have two comparable sides; 5 of those are excluded by name for attribute-serialization
// differences (see EXCLUDED).

import { describe, expect, test } from 'bun:test'
import { state } from '../../shared/state.ts'
import { watch } from '../../shared/watch.ts'
import { loadEmitted } from './emit.ts'
import { FIXTURES, type Fixture } from './emitFixtures.ts'

// Mirrors `emit.oracle.test.ts` — a script fixture gets the page scope `pages.ts` builds (imports +
// framework bindings); a template fixture carries its own scope factory. Called ONCE PER SIDE so the
// hydrate and the mount start from independent reactive graphs, exactly as two processes would.
function scopeFor(fixture: Fixture): Record<string, unknown> {
    if (fixture.kind === 'script') {
        const props = fixture.props ? fixture.props() : {}
        const imports = fixture.imports ? fixture.imports() : {}
        return { ...imports, state, watch, props: () => props }
    }
    const scope = fixture.scope
    if (scope === undefined) throw new Error('a template fixture must carry a scope factory')
    return scope()
}

// Let every already-settled promise in the graph flush. A `{#await}`/`{#for await}` block resolves over
// microtasks on BOTH sides, so comparing before they drain compares two different points in time rather
// than two implementations.
async function settle(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve()
}

// Strip the comment anchors and collapse the whitespace they used to separate. See the header: anchor
// POSITION is what the walk depends on and is exercised by the walk itself (a wrong position claims the
// wrong node and the surviving CONTENT diverges); anchor TEXT and count legitimately differ between a
// claimed region and a freshly mounted one.
function content(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, '')
}

// Fixtures whose two sides differ for a reason that is NOT the anchor contract, named individually so
// the assertion stays exact for everyone else. Every entry here is an ATTRIBUTE-VALUE or attribute-ORDER
// difference — no structural one survived, which is the point. They are real emitter asymmetries and are
// listed so they are on the record; none changes what the browser computes.
const EXCLUDED = new Map<string, string>([
    // Server → the literal `style` string the emitter built (`color: red`). Hydrate claims the element and
    // per decision 9 writes NOTHING on pass 1, so the raw attribute survives. Mount instead goes through
    // `style.setProperty`, and re-serializing the CSSOM adds the trailing `;` and normalizes `0` to `0px`.
    // Identical computed style either way; only `innerHTML` can tell them apart.
    ['style directive', 'CSSOM re-serialization: `color: red` (claimed) vs `color: red;` (set)'],
    [
        'multiple style directives',
        'CSSOM re-serialization: `margin: 0` (claimed) vs `margin: 0px;` (set)',
    ],
    ['static style + style directive merge', 'CSSOM re-serialization, as above'],
    // The SERVER trims and collapses a static `class` (`"  a b  "` → `"a b"`); the client clone keeps the
    // author's literal. A whitespace-separated token list, so both match the same CSS — but the two
    // emitters really do disagree here, and only a claimed-vs-mounted comparison shows it.
    [
        'static class trimmed and merged',
        'server trims a static class attribute, the clone skeleton does not',
    ],
    // Static attributes come from the clone skeleton and dynamic ones are set afterwards, so a mounted
    // element serializes them static-first; the server writes them in source order. Attribute order is
    // not observable to CSS, the DOM, or a reader.
    [
        'mixed static and dynamic attr order',
        'attribute serialization order differs; the set is identical',
    ],
])

describe('plan parity — render() → hydrate() equals mount()', () => {
    for (const fixture of FIXTURES) {
        // A one-sided fixture (`server: false` / `client: false`) has no second side to compare against,
        // and a `throws` fixture has no parity statement to make: `hydrate` deliberately has NO throw path
        // (an unrecoverable claim falls back to a fresh mount, which is what lets `bootstrap` promise that
        // hydration never leaves a page corrupted).
        if (fixture.server === false || fixture.client === false || fixture.throws) continue
        const excluded = EXCLUDED.get(fixture.name)
        if (excluded !== undefined) {
            test.skip(`${fixture.name} — ${excluded}`, () => {})
            continue
        }
        test(fixture.name, async () => {
            const emitted = await loadEmitted(fixture.src)

            // (1) the SSR paint, claimed in place.
            const hydrateScope = scopeFor(fixture)
            const hydrated = document.createElement('div')
            hydrated.innerHTML = await emitted.render(hydrateScope)
            const disposeHydrated = emitted.hydrate(hydrated, hydrateScope)
            await settle()

            // (2) the same page built from scratch.
            const mountScope = scopeFor(fixture)
            const mounted = document.createElement('div')
            const disposeMounted = emitted.mount(mounted, mountScope)
            await settle()

            expect(content(hydrated.innerHTML)).toBe(content(mounted.innerHTML))

            disposeHydrated()
            disposeMounted()
        })
    }
})

// The bug the sweep above found, pinned to its mechanism so a regression is legible rather than just a
// diff in a fixture name.
//
// `{#try}` runs its BODY first and only mounts `:catch` when that throws. Under hydration the server
// region does not hold a partial body paint at all — the body threw during SSR too, so what is painted
// is already the catch branch. `tryBlock`'s rollback walked back from its `<!--try-->` marker to a
// `boundary` captured BEFORE the body ran, which under hydration is the LAST server node of that painted
// catch branch: the loop stopped on its first step and removed nothing. The freshly mounted `:catch` then
// landed beside the SSR'd one and the block rendered twice. `render()`+`mount()` alone cannot see this —
// both are correct in isolation. The fix clears the whole region and rebuilds in create mode, which is
// the recovery `claimBlock` already performs for a structural mismatch.
describe('hydrationTryDuplication', () => {
    test('{#try} whose body throws mounts :catch ONCE on hydrate', async () => {
        const source = '{#try}{bad()}{:catch e}caught:{e.message}{/try}'
        const scope = (): Record<string, unknown> => ({
            bad: () => {
                throw new Error('nope')
            },
        })
        const emitted = await loadEmitted(source)

        const hydrateScope = scope()
        const host = document.createElement('div')
        host.innerHTML = await emitted.render(hydrateScope)
        const dispose = emitted.hydrate(host, hydrateScope)
        await settle()

        expect(content(host.innerHTML)).toBe('caught:nope')
        dispose()
    })

    test('{:finally} after a recovered {#try} body also builds exactly once', async () => {
        const source = '{#try}{bad()}{:catch e}c{e.message}{:finally}!{/try}'
        const scope = (): Record<string, unknown> => ({
            bad: () => {
                throw new Error('x')
            },
        })
        const emitted = await loadEmitted(source)

        const hydrateScope = scope()
        const host = document.createElement('div')
        host.innerHTML = await emitted.render(hydrateScope)
        const dispose = emitted.hydrate(host, hydrateScope)
        await settle()

        expect(content(host.innerHTML)).toBe('cx!')
        dispose()
    })
})
