// What the handover from a server render to the browser costs, for a handler that YIELDS.
//
// The walk drains the stream to build the markup, so every chunk is already on screen when the
// client boots. What used to happen next is the whole point of this file: the client's slot is
// per-caller and cold, so its first read re-streamed the answer FROM THE TOP — duplicated rows for
// a list of five, and for anything generated a second full generation, paid twice and watched
// restarting.
//
// Nothing about the rows says so. They are identical either way, which is why the page existed with
// this in it and every markup assertion stayed green. The claim is the REQUEST COUNT, so that is
// what this counts — and it has to be a browser, because the seed block is read off the document and
// a headless run has no document that was served.

import { expect, interactive, test } from 'harness/e2e'

/** The endpoint the streamed panel reads. Matched loosely: the args ride the query string. */
const TICKS = /ticks\/ticks/

test('a streamed panel is adopted, not re-fetched', async ({ page }) => {
    const asked: string[] = []
    page.on('request', (request) => {
        if (TICKS.test(request.url())) asked.push(request.url())
    })

    await page.goto('/streaming?ms=50')
    await interactive(page)

    const rows = page.locator('#streamed li')
    await expect(rows).toHaveCount(5)
    expect(await rows.allInnerTexts()).toEqual(['5', '4', '3', '2', '1'])

    // The one line this file exists for. The rows above are green whether the browser adopted them
    // or re-streamed them; only this says which.
    expect(asked, 'the browser re-streamed an answer already on screen').toEqual([])
})
