// 41.19 — A RENDER LETS THE TURN RUN BETWEEN SETTING A PAGE UP AND BUILDING IT. A handler that answers
// without waiting on anything is `async` all the same, so it lands a microtask after the call that
// started it — and a body built in the same breath as the setup painted it as a hole every time.
// What is asserted is the markup the server sent, and that nothing was set up twice to get it.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { renderDocument } from '#server/render.ts'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import { closeTyped, serverOf } from './typed.ts'

// Held, and answered from what it holds: nothing to wait on but its own `async`.
const GET_INVOICE = `import { GET } from '@abide/abide/server'

let setups = 0

export default GET(async ({ id }: { id: string }) => {
    setups += 1
    return { id, setups }
})
`

// Waits on the clock, which no turn is long enough for: still a hole, filled by the browser (41.4).
const GET_SLOW = `import { GET } from '@abide/abide/server'

export default GET(async () => {
    await new Promise((done) => setTimeout(done, 200))
    return 'late'
})
`

// THE PAGE IS UNDER A LAYOUT, which is the case the build order made hardest: the page used to be set
// up inside the layout's markup, after every chance to wait had passed.
const LAYOUT = `<main><slot/></main>`

const PAGE = `<script>
import { reactive } from '@abide/abide'
import getInvoice from '#src/invoices/getInvoice.handler.ts'
import getSlow from '#src/invoices/getSlow.handler.ts'

const invoice = reactive(() => getInvoice({ id: '4021' }))
const slow = reactive(() => getSlow())
</script>

<p id="invoice">{invoice().id} {invoice().setups}</p><p id="slow">{slow()}</p>`

let stop = (): void => {}
let base = ''

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'layout.abide': LAYOUT,
        'index.abide': PAGE,
        'invoices/getInvoice.handler.ts': GET_INVOICE,
        'invoices/getSlow.handler.ts': GET_SLOW,
    }))
}, 30_000)

afterAll(async () => {
    stop()
    removeTemporaryModules()
    await closeTyped()
})

// THE REVERT: drop the `setImmediate` wait in `composePage`; the invoice is a hole like the slow one,
// and `<p id="invoice"> </p>` is what is sent.
test('a value that answers within the turn is painted, and one that waits is a hole — 41.19', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    // One setup, so one run: the page was not set up a second time to paint it.
    expect(html).toContain('<p id="invoice">4021 1</p>')
    expect(html).toMatch(/<p id="slow">(<!--[^>]*-->)*<\/p>/)
    expect(html).toContain('<main>')
})

// 41.2 — EVERY ASYNCHRONOUS READ IS STARTED UP FRONT, so two loads a page reads overlap rather than
// queue: the second has started before the first has answered, and the render costs the slower of
// the two rather than their sum — which holds because a body starts where it is built (1.7), not
// where it is read. THE REVERT, as the two serialized by hand: `await first` at the head of
// `second`'s body — `overlapped` reads false where true is due.
test('a render starts every asynchronous read before any answers — 41.2', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

const seen = ((globalThis as { overlap?: { firstDone: boolean; overlapped: boolean } }).overlap ??= {
    firstDone: false,
    overlapped: false,
})
const first = reactive(async () => {
    await new Promise((done) => setTimeout(done, 20))
    seen.firstDone = true
    return 'one'
})
const second = reactive(async () => {
    seen.overlapped = !seen.firstDone
    await new Promise((done) => setTimeout(done, 20))
    return 'two'
})
</script>

<p>{first()} {second()}</p>`
    const dir = temporaryModule({ 'Overlap.ts': await serverOf(source) })
    const { default: Component } = await import(`${dir}/Overlap.ts`)
    await renderDocument(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    )
    await new Promise((done) => setTimeout(done, 60))
    expect(
        (globalThis as { overlap?: { overlapped: boolean } }).overlap
            ?.overlapped,
    ).toBe(true)
})
