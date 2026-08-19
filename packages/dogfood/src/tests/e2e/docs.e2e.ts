// Every reference page, in a real browser.
//
// `#tests/unit/docs.test.ts` already asserts that every public name has a rung and that every rung carries the
// text of a real file, and `bun test` mounts the mountable rungs. None of that can see the thing this
// file is for: a rung that renders on the server and then throws in the browser, or a page whose preview
// is markup with nothing behind it.
//
// Derived from `CALLABLES.ts` rather than from a list written here, so a name added to abide is covered
// without anybody remembering to add it. That file is plain TypeScript whose ladders are `import()`
// thunks, which is why a playwright process can read it without pulling one rung.

import { expect, interactive, type Page, test } from 'harness/e2e'
import { CALLABLES } from '#shared/demos/CALLABLES.ts'
import { SPELLINGS } from '#shared/demos/SPELLINGS.ts'
import { CALLABLE_ORDER, SPELLING_ORDER, TOPIC_ORDER, TOPICS } from '#shared/demos/TOPICS.ts'
import { type Swept, sweepStatuses } from './internal/drive.ts'

/**
 * Every rung's SOURCE is on the page, painted, not blank, and not running off the card.
 *
 * Blank is one failure worth catching: the text arrives through `?source`, so a loader change turns
 * every example into an empty frame while every other assertion in the repo still passes.
 *
 * ONE PANE per rung, always — a rung that crosses the seam is two files behind a TAB STRIP, so the
 * second is a click rather than a second `<pre>`. The tabs are pressed here rather than assumed: a
 * strip that renders and does not switch is markup with nothing behind it, which is the whole reason
 * this file drives a real browser. Both halves are asserted non-empty and DIFFERENT, because a strip
 * showing one file under two labels would satisfy every other check in the repo.
 *
 * The selector is scoped to `.files`. It was `[data-rung] pre`, which also matched the `<pre>` a
 * PREVIEW renders its answer into — so the loose selector and a one-per-rung count failed together,
 * and fixing either alone would have left a check that reads as though it still guarded something.
 */
async function sourcesAreOnThePage(page: Page, name: string, rungs: number): Promise<void> {
    // The SYMPTOM, once per page and above the per-rung checks: a reference page never scrolls
    // sideways. Whatever grows past the window — a pane, a table, a preview somebody writes next year —
    // is caught here whether or not the check below happens to be looking at it.
    const spill = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(spill, `${name} scrolls sideways by ${spill}px`).toBeLessThan(2)

    for (let at = 0; at < rungs; at++) {
        const where = `${name} rung ${at + 1}`
        const rung = page.locator(`[data-rung="${at + 1}"]`)
        const pane = rung.locator('.files pre')
        expect(await pane.count(), `${where} does not show exactly one source pane`).toBe(1)
        const server = (await pane.innerText()).trim()
        expect(server.length, `${where} shows an empty pane`).toBeGreaterThan(20)

        // Contained rather than overflowing: the pane scrolls its own long lines instead of growing to
        // them. Asserted between the PANE and the box that holds it, which is where the failure was —
        // an 812px pane inside a 672px column, running off the card and taking the document to 1523 in
        // a 1440 window. Checked against the rung instead, `.files` itself fitted and the check passed
        // with the bug in: the first version of this assertion was green against a page it should have
        // failed, which is the whole reason the fix is reverted and re-run rather than eyeballed.
        const fits = await rung.evaluate((el) => {
            const box = el.querySelector('.files')
            const pane = box?.querySelector('.code-block')
            if (box === null || box === undefined || pane === null || pane === undefined) return true
            return pane.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1
        })
        expect(fits, `${where}: the source pane runs past the column that holds it`).toBe(true)

        // The PREVIEW's half of the same claim, and it is not the pane's mirror image: a rung is two
        // grid columns, so what the preview overflows is not the page but the SOURCE PANE next to it,
        // and the sideways-scroll check above sees none of it. A `<form>` whose file input has a
        // min-content wider than the column put a button 106px under `.files`, where the page rendered
        // perfectly and the click landed on a comment span — which is a rung nobody can press.
        const contained = await rung.evaluate((el) => {
            const preview = el.querySelector('.rung-preview')
            if (preview === null) return true
            const edge = preview.getBoundingClientRect().right
            for (const child of preview.children) {
                if (child.getBoundingClientRect().right > edge + 1) return false
            }
            return true
        })
        expect(contained, `${where}: the preview runs past the column that holds it`).toBe(true)

        // A tab strip is two tabs or no strip at all. One tab is chrome that says nothing, and three
        // means a rung grew a file the page has no vocabulary for.
        const tabs = rung.locator('.tab')
        const count = await tabs.count()
        expect([0, 2], `${where} has ${count} tabs`).toContain(count)
        if (count === 0) continue

        await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
        await tabs.nth(1).click()
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
        expect(await pane.count(), `${where} shows both files at once after a tab press`).toBe(1)
        const client = (await pane.innerText()).trim()
        expect(client.length, `${where} shows an empty client half`).toBeGreaterThan(20)
        expect(client === server, `${where} shows one file under both tabs`).toBe(false)
        await tabs.nth(0).click()
    }
}

/**
 * Every rung's proofs, run in this browser and TERMINAL — see `#shared/demos/proofs.ts`.
 *
 * Here rather than under `bun test`: a page loads only the ladders its own name is in, so each rung is
 * mounted once and nothing else in the process holds an opinion about the module-level cells inside it.
 *
 * `passing` and not merely "settled", which is what makes this the check on `sweepStatuses`' own
 * assumption that the last badge settling is all of them settling — a rung left `running` is not
 * `passing`, so a queue that stalled mid-ladder is red here rather than invisible.
 */
async function proofsHold(page: Page, name: string): Promise<void> {
    const swept = await sweepStatuses(page, '[data-rung]', '.proofs summary .badge', 30_000)
    const red: string[] = []
    for (let at = 0; at < swept.length; at++) {
        const { label, status } = swept[at] as Swept
        // A rung with no `view` renders no proofs, which is a rung with nothing to disagree about.
        if (status !== null && status !== 'passing') red.push(`${name} rung ${at + 1} (${label}) is ${status}`)
    }
    expect(red, 'a documented example the two substrates disagree about').toEqual([])
}

test('/docs indexes the whole surface', async ({ page, complaints }) => {
    await page.goto('/docs')

    // One card per public name, and the count is the claim: a grid that silently rendered half the list
    // still looks like an index.
    const cards = page.locator('[data-callable]')
    expect(await cards.count(), '/docs does not list every name').toBe(CALLABLE_ORDER.length)

    // And one per SPELLING, on this same page, which is what grouping by topic bought: the two
    // vocabularies interleave by subject instead of sitting in two lists a reader has to choose between.
    const spellings = page.locator('[data-spelling]')
    expect(await spellings.count(), '/docs does not list every spelling').toBe(SPELLING_ORDER.length)

    // Grouped by TOPIC — what a name is about, rather than which door it is behind.
    const groups = page.locator('[data-topic]')
    expect(await groups.count(), '/docs lost a topic').toBe(TOPIC_ORDER.length)

    // The lead is the one thing a per-name page cannot say, so a section that lost it is a section that
    // says nothing its heading did not. Exact rather than `hasText`, which is a case-insensitive
    // substring match and would pass against a truncated one.
    const first = TOPIC_ORDER[0] as (typeof TOPIC_ORDER)[number]
    await expect(page.locator(`[data-topic="${first}"] .topic-lead`)).toHaveText(TOPICS[first].lead)

    expect(complaints.unexpected(), '/docs logged errors').toEqual([])
})

for (const name of CALLABLE_ORDER) {
    test(`/docs/${name} renders its ladder`, async ({ page, complaints }) => {
        await page.goto(`/docs/${name}`)

        // The import line is the first thing on the page and the thing most likely to be copied, so it
        // is asserted as an EXACT string. `hasText` matches case-insensitively and as a substring, which
        // would pass against `GET` on the `get` page.
        await expect(page.locator('pre').first()).toHaveText(`import { ${name} } from '${CALLABLES[name].from}'`)

        // The pitfall, level with the import. Asserted as the EXACT string for the same reason the
        // import line is: `hasText` would pass against a box that rendered the first clause and stopped.
        await expect(page.locator('.pitfall-body')).toHaveText(CALLABLES[name].pitfall)

        // Every rung is a numbered section with the one thing it adds as its heading, located by the
        // `data-rung` the page numbers it with. At least one — `docs.test.ts` proves the count is not
        // zero for any name, and this proves the page actually drew it.
        const rungs = page.locator('[data-rung]')
        await expect(rungs.first()).toBeVisible()
        const count = await rungs.count()

        await sourcesAreOnThePage(page, name, count)

        await proofsHold(page, name)

        // Stated here as well as in the fixture's teardown, and not only to satisfy a linter: a fixture
        // has to be REQUESTED to be active, so a page whose console nobody destructured is a page nobody
        // is listening to. Written at the call site, the claim is visible in the test rather than in the
        // harness. Hydration warnings are deliberately somebody else's file — see `hydration.e2e.ts`.
        expect(complaints.unexpected(), `${name} logged errors`).toEqual([])
    })
}

test('/docs/syntax indexes the whole language', async ({ page, complaints }) => {
    await page.goto('/docs/syntax')

    const cards = page.locator('[data-spelling]')
    expect(await cards.count(), '/docs/syntax does not list every spelling').toBe(SPELLING_ORDER.length)
    expect(complaints.unexpected(), '/docs/syntax logged errors').toEqual([])
})

for (const slug of SPELLING_ORDER) {
    test(`/docs/syntax/${slug} renders its ladder`, async ({ page, complaints }) => {
        // The one failure this axis DEMONSTRATES, and on the ONE page that demonstrates it: `{#if}`'s
        // ladder carries the rung whose load refuses on purpose, so its failure arm has something real
        // to report — and a read of a failed load is written to `abide:load`, which is the behaviour
        // that rung is teaching. Declared by the rung's own reason rather than by muting the channel,
        // so any OTHER load failing here is still a failure; and named for `if` alone rather than for
        // all fifteen, because `expected` REQUIRES the line, so the fourteen that never log it would be
        // red — which is the property that makes this a claim about the page and not a hole in the gate.
        if (slug === 'if') complaints.expected('a load failed: no such row')
        await page.goto(`/docs/syntax/${slug}`)

        // The heading is the SPELLING as it is typed — `{#for}`, not `for` — because that is what a
        // reader arrived holding. Exact, since `toHaveText` on a substring would pass `for` against it.
        await expect(page.locator('.page-title')).toHaveText(SPELLINGS[slug].name)

        // And there is NO import line, which is the one way this page differs from a callable's: a
        // block imports nothing, and a `<pre>` telling somebody to import `{#for}` would be a lie the
        // shared component is one prop away from telling.
        expect(await page.locator('.import-line').count(), 'a spelling is not imported from anywhere').toBe(0)

        // The pitfall IS on both axes, unlike the import line — which is the asymmetry worth asserting
        // here rather than assuming: a template spelling fails more quietly than a callable does, so
        // this is the axis the prose earns its place on.
        await expect(page.locator('.pitfall-body')).toHaveText(SPELLINGS[slug].pitfall)

        const rungs = page.locator('[data-rung]')
        await expect(rungs.first()).toBeVisible()
        const count = await rungs.count()

        await sourcesAreOnThePage(page, slug, count)

        // The same per-rung sweep the callable pages get. It matters more here: this axis is where the
        // template rungs live, so every mountable example in the language is built, server-rendered
        // and hydrated over on one of these fifteen pages — including the one that streams, which is
        // the rung the sweep was silently sampling mid-run.
        await proofsHold(page, slug)

        expect(complaints.unexpected(), `${slug} logged errors`).toEqual([])
    })
}

test('a spelling a `.abide` file does not have is a 404, not an apology', async ({ page }) => {
    const answered = await page.goto('/docs/syntax/nonsense')
    expect(answered?.status()).toBe(404)
})

test('a mounted rung is live, not a picture of itself', async ({ page }) => {
    // `state`'s first rung is a counter, which is the smallest thing that can prove the preview is
    // hydrated rather than server markup sitting there: the button has to change the number.
    await page.goto('/docs/state')
    // The rung's button is the client's. See `interactive` — `goto` resolves before hydration.
    await interactive(page)
    const first = page.locator('[data-rung="1"]')
    // Inside the PREVIEW, not the first `<p>` in the rung: the rung's own heading block carries one
    // saying which callables it is `of`, and `p` alone silently started matching that instead.
    const line = first.locator('.rung-preview p').first()
    await expect(line).toHaveText(/count 0/)

    await first.getByRole('button', { name: 'add one' }).click()
    await expect(line).toHaveText(/count 1/)
})

test('a form rung posts both spellings at one endpoint', async ({ page, complaints }) => {
    // The claim `/docs/POST`'s form rung makes is that a body no stub encoded arrives as ARGUMENTS,
    // and neither half of it is reachable headless: a `<form>` only serialises the way a browser
    // serialises it, and only a browser can put a real file on a file input.
    await page.goto('/docs/POST')
    await interactive(page)

    // Located by its own buttons rather than by `data-rung="4"`: this page filters the transport
    // ladder down to the rungs `of: ['POST']`, so the index moves whenever any of them does.
    const rung = page
        .locator('[data-rung]')
        .filter({ has: page.getByRole('button', { name: 'post it as multipart' }) })
    const answer = rung.locator('.rung-preview pre')
    await expect(answer).toHaveText('nothing sent yet')

    await rung.locator('input[type="file"]').setInputFiles({
        name: 'august.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# august\n'),
    })

    // Multipart: the declared shape read `36` as a number, the repeated `tags` as a list, and the
    // file — which is the one thing this spelling can carry — landed on the declared `File`.
    await rung.getByRole('button', { name: 'post it as multipart' }).click()
    await expect(answer).toHaveText(
        'multipart — {"name":"ada","age":36,"tags":["x","y"],"isNumber":true,"avatar":{"name":"august.md","bytes":9}}',
    )

    // The other spelling at the SAME address with the SAME field names, differing only where the two
    // genuinely differ: `avatar` is null because urlencoded has nowhere to put the file.
    await rung.getByRole('button', { name: 'post it urlencoded' }).click()
    await expect(answer).toHaveText(
        'urlencoded — {"name":"ada","age":36,"tags":["x","y"],"isNumber":true,"avatar":null}',
    )

    expect(complaints.unexpected(), 'the form rung logged errors').toEqual([])
})

test('a framed rung fills from the handle\'s own transcript', async ({ page, complaints }) => {
    // The rung that reads a `jsonl()` body through the STUB, which is the half `/docs/sse`'s test
    // below does not cover — it presses the `EventSource` rung. Both rungs are one line apart on
    // purpose, so this is also what says the pair still differ only in their import.
    //
    // Worth a browser rather than a `run` face for the reason the rungs were rewritten: they used to
    // accumulate with `rows = [...rows, row]` around a `for await`, and now they render
    // `catalogue().chunks()` — the handle's LIVE transcript — behind an `{#if}` the button opens. That
    // a growing buffer with a version behind it still wakes a `{#for}` per chunk is a claim about the
    // render path, and the render path is only real here.
    await page.goto('/docs/jsonl')
    await interactive(page)

    const rung = page.locator('[data-rung="1"]')
    const rows = rung.locator('.rung-preview li')
    // A READ starts the load, so nothing has been asked for yet — which is also what keeps the rpc
    // off the server render of this page.
    await expect(rows).toHaveCount(0)

    await rung.getByRole('button', { name: 'ask for them' }).click()
    await expect(rows).toHaveCount(3, { timeout: 15_000 })
    // Exact and case-sensitive, and the LAST row, so a transcript that delivered one chunk and
    // stopped waking readers cannot read as a pass.
    await expect(rows.last()).toHaveText('3')

    expect(complaints.unexpected(), 'jsonl logged errors').toEqual([])
})

test('a template for-await rung appends its rows one at a time', async ({ page, complaints }) => {
    // `{#for await}` in a block head, over a source that PAUSES between rows — which is the half a
    // headless lane cannot make, because what the rung claims is that the page is complete after each
    // row rather than after the last. Counting only the final five would pass against a loop that
    // collected the whole stream and rendered it once, so the count is read WHILE it fills.
    await page.goto('/docs/jsonl')
    await interactive(page)

    const rung = page.locator('[data-rung="2"]')
    const rows = rung.locator('.rung-preview li')
    await expect(rows).toHaveCount(0)

    await rung.getByRole('button', { name: 'ask for them' }).click()
    // Partway: the source pauses 150ms per row, so a page that only paints at the end cannot be here.
    await expect(rows).toHaveCount(1, { timeout: 10_000 })
    await expect(rows).toHaveCount(5, { timeout: 15_000 })
    await expect(rows.last()).toHaveText('5')

    expect(complaints.unexpected(), 'the template loop logged errors').toEqual([])
})

test('an sse rung actually receives its events, over a real EventSource', async ({ page, complaints }) => {
    // The one claim on `/docs/sse` that no headless lane can make at all. Rung 2 reads the stream
    // through the stub, which `bun test` already proves in-process; rung 3 hands the ADDRESS to the
    // browser's own `EventSource`, and nothing about that exists outside a browser — happy-dom has no
    // `EventSource`, and `loopback()` never puts an HTTP server on an origin one could point at.
    //
    // So this is what stops the rung from being a picture: the ticker yields five values 300ms apart,
    // and rows appearing one after another is the only evidence that a mounted `url()` resolved to a
    // route that answered `text/event-stream` and that the browser parsed the frames.
    //
    // Rung TWO, not three: `/docs/<callable>` numbers the rungs it shows, and it shows only the ones
    // `of` that name — so a ladder position is not a page position.
    await page.goto('/docs/sse')
    await interactive(page)

    const rung = page.locator('[data-rung="2"]')
    const rows = rung.locator('.rung-preview li')
    await expect(rows).toHaveCount(0)

    await rung.getByRole('button', { name: 'listen' }).click()
    // The whole sequence, so a stream that delivered one frame and stalled is not read as a pass.
    await expect(rows).toHaveCount(5, { timeout: 15_000 })
    // The LAST one, because arriving in order is half of what a stream claims — and `toHaveText` is
    // exact and case-sensitive, so this cannot pass on a substring the way `hasText` would.
    await expect(rows.last()).toHaveText('{"at":5}')

    expect(complaints.unexpected(), 'sse logged errors').toEqual([])
})

test('a render rung answers in the APP’s own document, and one in its own', async ({ page, complaints }) => {
    // `shell: true` is the only claim on `/docs/render` that no headless lane can make: the app's
    // document is published by BOOT — `app.html` off the disk, with the stylesheets the build wrote —
    // so `bun test` renders abide's own fallback and a served route renders this app's. Both rungs are
    // driven here, because what they are worth is the DIFFERENCE: same report, same scoped rules, and
    // everything around them is the app's in one and the route's in the other.
    await page.goto('/docs/render')
    await interactive(page)

    const apps = page.locator('[data-rung="3"] .rung-preview pre')
    await expect(apps).toHaveText('nothing asked yet')
    await page.locator('[data-rung="3"]').getByRole('button', { name: 'shell' }).click()
    // The app's own head, which is what `shell: true` MEANS — the title is `app.html`'s and nothing
    // else in the repo writes it.
    await expect(apps).toContainText('<title>abide dogfood</title>')
    // The stylesheets are the build's, so this is also the assertion that a served route reaches the
    // manifest rather than a document parsed from source alone.
    await expect(apps).toContainText('<link rel="stylesheet"')
    // The component's own scoped block, in the head — the one thing a hand-written doctype could not
    // carry, and the reason the option exists.
    await expect(apps).toContainText('tabular-nums')
    // The opening tag alone, because a component carrying a scoped block has its scope attribute
    // stamped on every element of it — which is the same fact `tabular-nums` above is about.
    await expect(apps).toContainText('<slot><h1 data-a')
    await expect(apps).toContainText('41 open · 7 closed')
    // Off by default, and it stays off: the client mounts the pages route table at the outlet, and
    // this path is not in it.
    await expect(apps).not.toContainText('<script type="module"')

    const own = page.locator('[data-rung="4"] .rung-preview pre')
    await page.locator('[data-rung="4"]').getByRole('button', { name: 'shell' }).click()
    await expect(own).toContainText('<title>may — filed</title>')
    await expect(own).toContainText('<body class="filed">')
    // The same scoped rules in a document that knows nothing about them, which is what makes the
    // styles the RENDER's business rather than the shell's.
    await expect(own).toContainText('tabular-nums')
    // The app's document did not leak into the route's own.
    await expect(own).not.toContainText('abide dogfood')

    expect(complaints.unexpected(), 'the render rungs logged errors').toEqual([])
})

test('a preview scrolls a long line rather than painting across the page', async ({ page, complaints }) => {
    // The per-page spill check in `sourcesAreOnThePage` is written as the net for exactly this, and it
    // could not see it: a preview is DORMANT until somebody presses it, so the answer that overflows
    // does not exist while the ladder is merely being loaded. Pressing every preview on every page is
    // not the way to close that — `navigate`'s buttons leave the page and `error`'s log on purpose, so
    // the sweep would arrive carrying five exceptions. One press on one page is the whole claim.
    //
    // `request` is the page it happened on and the one that cannot stop happening: the answer is a
    // `JSON.stringify` of the browser's own user-agent, which is a single unbreakable line whatever the
    // browser and however wide the window. Measured at 1453px inside a 490px box, painted across the
    // source pane beside it and took the document to 1799 in a 1566 window.
    await page.goto('/docs/request')
    await interactive(page)
    const rung = page.locator('[data-rung="1"]')
    await rung.getByRole('button', { name: 'ask the server' }).click()
    const answer = rung.locator('.rung-preview pre')
    await expect(answer).toBeVisible()

    // The containment first, because that is the assertion the revert moves: with either half of the
    // fix out — or both — the pre measures the same 1453px in a 222px box, since fit-content sizing and
    // the item's automatic minimum size hold it there independently. The spill below is the symptom a
    // reader saw and is kept for that, not because it distinguishes anything the line above does not.
    const contained = await rung.evaluate((el) => {
        const box = el.querySelector('.rung-preview')
        const pre = box?.querySelector('pre')
        if (box === null || box === undefined || pre === null || pre === undefined) return false
        return pre.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1
    })
    expect(contained, 'the preview paints its answer past the box that holds it').toBe(true)

    const spill = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(spill, `an answered preview scrolls the page sideways by ${spill}px`).toBeLessThan(2)

    expect(complaints.unexpected(), 'request logged errors').toEqual([])
})

test('a preview that answers in prose is not painted as code', async ({ page, complaints }) => {
    // `#ui/lib/Answer.abide` asks `JSON.parse` whether the text is DATA before handing it to a grammar,
    // and this is the case that asked for it: `identity`'s second rung answers with a refusal, in
    // English, into the same `<pre>` its other buttons put JSON in. Painted as JavaScript that sentence
    // comes back speckled — `set` as a call, every `.` and `:` and the em-dash as punctuation, 12 runs
    // in all — and a sentence with a straight apostrophe in it is worse, because the quote opens a
    // string that greens the rest of the line.
    //
    // NOT a claim about the painter, which is why it is asserted here rather than in `site.test.ts`:
    // sugar-high gets the same two strings identically wrong, and every valid-JSON payload round-trips
    // through `painted` correctly. The question is whether the text is data, and only a parse answers it.
    await page.goto('/docs/identity')
    await interactive(page)
    const rung = page.locator('[data-rung="2"]')
    await rung.getByRole('button', { name: 'try writing one from this page' }).click()

    const answer = rung.locator('.rung-preview pre')
    await expect(answer).toContainText('refused here')

    // Zero and not "fewer": an unpainted run is TEXT rather than a `<span>` carrying no class, so a
    // sentence that reached the painter at all leaves elements behind. See `#ui/lib/Code.abide`.
    const runs = await answer.locator('span').count()
    expect(runs, `the refusal is painted as JavaScript in ${runs} places`).toBe(0)

    expect(complaints.unexpected(), 'identity logged errors').toEqual([])
})

test('the exporting rung shapes a real span out of this app’s own middleware', async ({ page, complaints }) => {
    // `/docs/trace`'s last rung, and the only claim on that page that a headless lane cannot make: the
    // rung is really in `packages/dogfood/app.ts`'s middleware array, so what comes back was shaped by
    // THIS process answering a request rather than by a fixture building a record.
    await page.goto('/docs/trace')
    await interactive(page)

    // Third on the page — `trace` slices rungs 4, 10 and 11 out of the `request` ladder.
    const rung = page.locator('[data-rung="3"]')
    const answer = rung.locator('.rung-preview pre')
    const press = rung.getByRole('button', { name: 'what would have been posted' })

    await press.click()
    // The two ids are the point: they are what `traceresponse` handed the caller, so a record carrying
    // them is one a backend can stitch to. 32 and 16 hex, which is what makes this more than "not null".
    await expect(answer).toContainText(/"traceId": "[0-9a-f]{32}"/)
    await expect(answer).toContainText(/"spanId": "[0-9a-f]{16}"/)
    // Shaped as OTLP rather than as whatever was handy: nanoseconds as a STRING, and `SERVER` kind.
    await expect(answer).toContainText(/"startTimeUnixNano": "\d{19}"/)
    await expect(answer).toContainText('"kind": 2')

    // A second press is a second request, so the span it reports is a DIFFERENT hop — which is what
    // says this is being shaped per request rather than built once and cached.
    const first = (await answer.textContent()) ?? ''
    await press.click()
    await expect(answer).not.toHaveText(first)

    expect(complaints.unexpected(), 'the exporting rung logged errors').toEqual([])
})

test('the policy page shows both halves — the one nobody asked for, and the one `csp()` adds', async ({
    page,
    complaints,
}) => {
    // `/docs/csp` used to be one rung about the middleware, which left a reader with no way to learn
    // that a page carries a policy WITHOUT it. Two rungs now, and the diff between the two answers is
    // the whole claim — so both are pressed here, in the browser that enforces the second one.
    await page.goto('/docs/csp')
    await interactive(page)

    const free = page.locator('[data-rung="1"]')
    await free.getByRole('button', { name: 'what a page carries with nothing installed' }).click()
    // EXACT, because "contains `object-src`" would also pass against `csp()`'s eleven-directive
    // baseline — which is the one wrong answer this rung could give.
    const already = free.locator('.rung-preview pre')
    await expect(already).toContainText('"policy": "object-src \'none\'; base-uri \'self\'"')

    const opted = page.locator('[data-rung="2"]')
    await opted.getByRole('button', { name: 'read the policy this page was served under' }).click()
    const served = opted.locator('.rung-preview pre')
    // This app installs `csp()`, so the document this test is reading was served under the whole
    // thing: the two free directives are still in it, and so is the nonce that only a render can mint.
    await expect(served).toContainText("object-src 'none'")
    await expect(served).toContainText("base-uri 'self'")
    await expect(served).toContainText(/script-src 'self' 'nonce-[\w-]{22}'/)

    expect(complaints.unexpected(), 'csp logged errors').toEqual([])
})

test('a name abide does not export is a 404, not an apology', async ({ page }) => {
    const answered = await page.goto('/docs/nowhere')
    expect(answered?.status()).toBe(404)
})
