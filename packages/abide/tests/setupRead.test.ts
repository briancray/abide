// 34.32 — A `<script>` SETUP THAT READ A VALUE STILL IN FLIGHT, on both sides and in every kind of
// setup: a component's, and a branch-local one in a row and in an arm.
//
// A FILE OF ITS OWN, with its own type session: checked after `hydrate.test.ts`'s spread fixtures in
// one session, the TypeScript 7 API process and the test both sat idle waiting on each other at the
// next `reads`, a deadlock in the checker's channel that no source here causes.

import { afterAll, expect, test } from 'bun:test'

import { click } from './click.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage, renderPage } from './typed.ts'
import { warningsWhile } from './warningsWhile.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

// `gate` holds the value in flight on whichever side a test asks, since a browser seeded from a
// server that landed it never meets the read unlanded — and is resolved once the test is done, since
// a value left in flight for ever is one a later render in this file waits on.
type Gate = ReturnType<typeof Promise.withResolvers<{ title: string }>>
const held = globalThis as { gate?: Gate | undefined }
const DETAIL = `let detail = reactive(() => globalThis.gate?.promise ?? { title: 'late' })`

const SETUP_CHILD = `<script>
import { props } from '@abide/abide'

const { detail } = props<{ detail: { title: string } }>()
const upper = detail.title.toUpperCase()
</script>

<b>{upper}</b>`

const SETUP_PAGE = `<script>
import { reactive } from '@abide/abide'
import Setup from './Setup.abide'

${DETAIL}
</script>

<main><Setup detail={detail}/></main>`

const SETUP_ARM = `<script>
import { reactive } from '@abide/abide'

${DETAIL}
let open = reactive(false)
</script>

<main>{#if open}<script>
const upper = detail.title.toUpperCase()
</script><b>{upper}</b>{/if}<button id="open" onclick={() => { open = true }}>open</button></main>`

const SETUP_ROW = `<script>
import { reactive } from '@abide/abide'

${DETAIL}
</script>

<ul>{#for n of [1]}<script>
const upper = detail.title.toUpperCase()
</script><li>{upper}</li>{/for}</ul>`

// THE REVERT: rethrow `thrown` in `setupThrown` and each of these reports `reactive has not landed`
// — and the arm's click throws nothing at all, the arm silently left unbuilt.
test("a setup's read of a value in flight is named as one — 34.32", async () => {
    const named =
        /<script> setup read a value that has not landed.*RULEBOOK 34\.32/
    const gate = (): void => {
        held.gate = Promise.withResolvers()
    }
    try {
        gate()
        // The server: a component's setup, and a branch-local one in a row.
        await expect(
            renderPage(SETUP_PAGE, { Setup: SETUP_CHILD }),
        ).rejects.toThrow(named)
        await expect(renderPage(SETUP_ROW)).rejects.toThrow(named)

        // The browser: the same component mounted where nothing was painted, as a navigation does.
        held.gate?.resolve({ title: 'late' })
        held.gate = undefined
        const page = await renderPage(SETUP_PAGE, { Setup: SETUP_CHILD })
        gate()
        document.body.innerHTML = '<!--[--><!--]-->'
        expect(() => page.mount()).toThrow(named)

        // And an arm's own setup, swapped in by a click once the page is up — reported, as any
        // effect that throws is (12.7, 12.8), where it used to be dropped as an abort. Caught at
        // `reportError`, where the drain hands it.
        await mountPage(SETUP_ARM)
        const reported: unknown[] = []
        const report = globalThis.reportError
        globalThis.reportError = (thrown: unknown): void => {
            reported.push(thrown)
        }
        try {
            warningsWhile(() => click('#open'))
        } finally {
            globalThis.reportError = report
        }
        expect(reported).toHaveLength(1)
        expect(reported[0]).toBeInstanceOf(Error)
        expect((reported[0] as Error).message).toMatch(named)
    } finally {
        held.gate?.resolve({ title: 'late' })
        held.gate = undefined
    }
})
