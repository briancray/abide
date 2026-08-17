// Does every use case still RENDER, and does it still carry the handles it is driven by?
//
// These were their own application until this change, with their own thin `pages.test.ts`. The claims
// are the same ones and they are worth as much here: a use case is a whole page at scale, driven from
// outside by a selector, so nothing in this repo notices if one stops rendering — and the failure
// arrives as a comparison run reporting nonsense on a Tuesday afternoon.
//
// What is asserted is deliberately shallow, and the shape of the claim is the point: the view still
// server-renders, and the CONTROLS the driver clicks are still in what it rendered. Anything about
// what an op COSTS belongs in a browser — absolute milliseconds out of happy-dom describe the
// emulator — so `#tests/e2e/usecases.e2e.ts` is where clicking one is asserted at all.
//
// THE SELECTORS ARE READ OFF `USECASES.ts` rather than listed here, which is what makes this a gate on
// the thing that actually drifts. A renamed button is a demo whose card silently shows one fewer
// metric, and "three ops where there were four" reads as a demo that got faster.

import { expect, test } from 'bun:test'
import { navigate } from 'abide'
import { isolate } from 'abide/internal'
import { component } from 'abide/runtime'
import { renderToString } from 'abide/server/internal'
import { SOURCES } from '#shared/demos/usecases/SOURCES.ts'
import { USECASES, USECASES_BY_NAME } from '#shared/demos/usecases/USECASES.ts'
// THE PAGE'S OWN TABLE, not a copy of it. This file used to restate the six views, so the gate below
// compared two lists the same author wrote and the thing `/demos/[name]` actually mounts was never in
// it. Importing the record is what makes `every use case has a view` a gate rather than a mirror.
import { VIEWS } from '#shared/demos/usecases/VIEWS.ts'

/** `#create` → `create`. The ops are SELECTORS, and what a server render can see is the id. */
const idOf = (selector: string): string => selector.replace(/^#/, '')

const USECASE_NAMES = Object.keys(USECASES_BY_NAME)

/**
 * Rendered the way `/demos/[name]` renders it: inside a request scope, at that demo's own address.
 *
 * The scope is not ceremony. `data` reads `route()` for its `?size=`, and a bare `renderToString`
 * throws "route() has nothing to answer about" — which this file did, and which the FULL `bun test`
 * run hid completely, because some other file had already navigated and left a scope behind. A test
 * that passes only next to its neighbours is a test of the neighbours.
 */
async function rendered(name: string): Promise<string> {
    const view = VIEWS[name]
    expect(view, `${name} has no view`).toBeDefined()
    return await isolate(async () => {
        await navigate(`/demos/${name}`)
        return await renderToString(component(view as NonNullable<typeof view>, {}))
    })
}

test('every use case has a view, and nothing has a view without being one', () => {
    expect(Object.keys(VIEWS).sort()).toEqual([...USECASE_NAMES].sort())
})

test('every use case has its source, and nothing has source without being one', () => {
    // BOTH DIRECTIONS, the way `docs.test.ts` gates `CALLABLES.ts`. A name in `USECASES` and not in
    // `SOURCES` is a demo page whose file panes are empty; the reverse is text in the route chunk that
    // nothing can reach.
    expect(Object.keys(SOURCES).sort()).toEqual([...USECASE_NAMES].sort())

    for (const name of USECASE_NAMES) {
        const files = SOURCES[name] ?? []
        expect(files.length, `${name} lists no files`).toBeGreaterThan(0)
        for (const file of files) {
            // Non-empty as its own claim: the text arrives through `?source`, which the loader inlines,
            // so a loader change turns every pane into an empty `<pre>` while the page still renders.
            expect(file.source.length, `${name}/${file.label} is empty`).toBeGreaterThan(50)
        }
        // The VIEW first, because it is what the reader just watched run.
        expect(files[0]?.label, `${name} does not show its view first`).toBe(
            `${name[0]?.toUpperCase()}${name.slice(1)}.abide`,
        )
    }
})

test('the names are distinct — two use cases cannot claim one address', () => {
    // Against the LIST rather than against a set of the keys, which cannot fail: a second use case
    // named `media` is one key holding the later of the two, so the record silently loses an entry and
    // `/demos/media` serves whichever one was written second.
    expect(USECASE_NAMES.length).toBe(USECASES.length)
})

for (const usecase of USECASES) {
    test(`${usecase.name} renders, with the controls its ops name`, async () => {
        const markup = await rendered(usecase.name)
        expect(markup.length, `${usecase.name} rendered nothing`).toBeGreaterThan(100)

        // The ids are the contract with the driver, and the only part of these views that is not free
        // to change. `data` is the one whose rows arrive over a wire — its controls are ABOVE the
        // pending branch on purpose, so this holds whether or not the answer landed.
        for (const op of usecase.ops) {
            expect(markup, `${usecase.name} no longer has ${op.on}`).toContain(`id="${idOf(op.on)}"`)
        }
    })
}

test('wake declares no ops, and that is an entry rather than a gap', () => {
    // The one demo that is itself a measurement. If it ever grows ops, the card stops explaining why it
    // has none and starts driving a ladder whose arms take seconds to settle — which prices the click.
    const wake = USECASES.find((usecase) => usecase.name === 'wake')
    expect(wake?.ops).toEqual([])

    // …and every other one HAS them, so an empty list cannot spread by accident.
    for (const usecase of USECASES) {
        if (usecase.name === 'wake') continue
        expect(usecase.ops.length, `${usecase.name} declares no ops`).toBeGreaterThan(0)
    }
})
