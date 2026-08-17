// A reader who clicks again before the first page has finished arriving.
//
// A browser gate by necessity, and the two claims below are the reason the served navigation path had
// none: it exists ONLY where there is a document. `bun test` drives `navigate` inside an `isolate`,
// which has a caller scope — so `drivesDocument()` is false there and every case in the routing suite
// takes the local arm. Nothing under `bun test` has ever reached `sink.enter`, which is why an
// overlapping pair of navigations went unasserted for as long as the mechanism existed.
//
// Both failures were SILENT in the way this repo's rules warn about: no throw, no console error, and
// markup that is correct markup — for a page the reader had already left. What told them apart was the
// address bar against the title, which is why every assertion here reads both.
//
// `/streaming?ms=2000` is the clock. It is the one route in this app that holds its response open, and
// the wait is a query parameter, so the two windows a second click can land in are separately
// reachable: BEFORE the first piece (the fetch is out, nothing has been repainted) and AFTER it (the
// range has been torn down and refilled, and no commit has claimed it yet).
//
// `__doc` is what says the client answered at all. Every one of these bugs also has an arrangement
// where `enter` gives up and hands the URL to the browser — the address bar then lands correctly, off
// a full document load, and an assertion reading only the URL passes against a page that never
// navigated. Verified by reverting each half of the fix in turn: the from-header half fails here as
// `FULL PAGE LOAD` and the others as the wrong title under `same-document`.

import type { Page } from '@playwright/test'
import { expect, interactive, test } from 'harness/e2e'

/** The route that waits, and the wait itself — long enough that a second click lands inside it. */
const SLOW = '/streaming?ms=2000'
const SLOW_MS = 2000

/** Two pages on ONE route, which is the arrangement the local arm is chosen by. */
const FROM = '/docs/state'
const TO = '/docs/route'

/**
 * Click in-app links, which is what the generated client entry listens for.
 *
 * Injected anchors rather than the app's own: the two claims are about WHEN the second click lands,
 * and hunting for a link still on screen mid-navigation would make the chrome part of the test. The
 * listener is on the document and matches `a[href^="/"]`, so these are real clicks.
 *
 * A LIST rather than one target, because that is the difference between the two cases: both clicks in
 * one call land in the same task, before the first fetch can answer, and two calls with a wait
 * between them land either side of the first piece.
 */
function clickAll(targets: string[]): void {
    for (const target of targets) {
        const link = document.createElement('a')
        link.href = target
        link.textContent = target
        document.body.append(link)
        link.click()
        link.remove()
    }
}

/** Where the reader ENDED UP, as the three facts that have to agree. */
function landed(page: Page): Promise<{ url: string; title: string | null; document: string }> {
    return page.evaluate(() => ({
        url: location.pathname + location.search,
        title: document.querySelector('.page-title')?.textContent?.trim() ?? null,
        // Set before the first click and lost to any full document load — see the header.
        document: ((window as unknown as Record<string, unknown>).__abideDoc as string) ?? 'FULL PAGE LOAD',
    }))
}

async function start(page: Page): Promise<void> {
    await page.goto(FROM)
    // Before the first click and never after: `goto` is not the barrier it looks like.
    await interactive(page)
    await page.evaluate(() => {
        ;(window as unknown as Record<string, unknown>).__abideDoc = 'same-document'
    })
}

test('a click while the answer is still on the wire is the one that lands', async ({ page }) => {
    await start(page)

    // Both clicks in ONE task, so the second is made before the first fetch can answer. This is the
    // window where the committed route still describes the screen, so the second move is answered
    // LOCALLY — instantly — and the slow one is then overtaken while it is still fetching.
    await page.evaluate(clickAll, [SLOW, TO])
    await page.waitForTimeout(SLOW_MS * 2)

    // The overtaken answer arrives with a whole page in it and a range it was told to fill. Standing
    // it is what this asserts against: the reader is on `/docs/route`, and a fragment painted over
    // them there is `/streaming`'s markup under `/docs/route`'s address.
    expect(await landed(page)).toMatchObject({ url: TO, title: 'route', document: 'same-document' })
})

test('a click while the first piece is already on screen is the one that lands', async ({ page }) => {
    await start(page)

    // Waited for, so the second click lands in the OTHER window: the address bar has moved, which is
    // what says the first piece stood, and the stream behind it is still open for ~2s.
    await page.evaluate(clickAll, [SLOW])
    await page.waitForURL(`**${SLOW}`)

    await page.evaluate(clickAll, [TO])
    await page.waitForTimeout(SLOW_MS * 2)

    // `/docs/state` and `/docs/route` are one route, so this is the move the client would normally
    // patch in place — and it cannot, because the page it would patch was torn down to make room for
    // the range standing there. Answered by the server instead, claiming no layouts, because the ones
    // the committed route names went the same way.
    expect(await landed(page)).toMatchObject({ url: TO, title: 'route', document: 'same-document' })
})
