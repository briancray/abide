// A client-side navigation onto a path nothing serves.
//
// A browser gate by necessity. The claim is that the reader stays in the SAME DOCUMENT — the error
// page is painted into the outlet rather than fetched as a new one — and "same document" is not a
// fact about markup. Both answers produce identical HTML; only a node planted before the move can
// tell them apart, which is exactly what a full reload destroys and what `bun test` has no way to
// observe, since the served navigation path is browser-only to begin with.
//
// What it is really guarding: `outletFrom` reads the committed route name, and a 404 commits an EMPTY
// one. Before `Cells.failure` existed that answered `NOTHING` and wiped the range the server had just
// filled — so the error page appeared and vanished a microtask later, which is a correct-looking
// server response and a blank screen.

import { expect, test } from 'harness/e2e'

test('a link to a path nothing serves paints the error page without leaving the document', async ({
    page,
    complaints,
}) => {
    // The browser's own record of the fetch, and it must arrive: the answer really is a 404, and a
    // navigation that came back 200 would be a page every crawler indexes as real. Declared rather
    // than filtered, so this fails in BOTH directions — an unexpected error fails the run, and this
    // one silently ceasing to happen fails it too.
    complaints.expected('404')

    await page.goto('/')

    // The witness. A property on `window` cannot survive a document swap, so if it is still here
    // after the move then the browser never reloaded — and if the reload happened, this is `undefined`
    // however right the markup looks.
    await page.evaluate(() => {
        ;(window as unknown as Record<string, unknown>).__stayed = 'same-document'
    })

    await page.evaluate(() => {
        const link = document.createElement('a')
        link.href = '/nothing-is-served-here'
        link.id = 'to-nowhere'
        link.textContent = 'go nowhere'
        document.body.appendChild(link)
    })
    await page.click('#to-nowhere')

    // The app's own error page, by its words rather than by a status — a client-side navigation has
    // no status to read, which is the whole reason the mark on the answer is what decides.
    await expect(page.locator('h1')).toHaveText('nothing is served here')
    // The failure it was rendered FROM, which is what crossed in the header: a message this side
    // could not have guessed, so its presence is the header being read rather than a page of static
    // apology text.
    await expect(page.locator('body')).toContainText('nothing is served at /nothing-is-served-here')

    // THE CLAIM.
    const stayed = await page.evaluate(() => (window as unknown as Record<string, unknown>).__stayed)
    expect(stayed, 'the browser reloaded the document instead of painting the error page').toBe('same-document')

    // And the address bar moved with it, or the reader is looking at a page they cannot link to or
    // reload — which is the same defect from the other side.
    expect(new URL(page.url()).pathname).toBe('/nothing-is-served-here')

    // Still a live page: the error page's own link works, and going back to a real route re-renders
    // the outlet rather than leaving the 404 standing. This is the half `Cells.failure` has to CLEAR
    // — a failure left behind renders a 404 over a route that matched perfectly well.
    await page.click('a[href="/"]')
    await expect(page.locator('h1')).not.toHaveText('nothing is served here')
    expect(new URL(page.url()).pathname).toBe('/')
})
