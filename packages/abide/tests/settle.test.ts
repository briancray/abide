// 41.19 — A RENDER LETS THE TURN RUN BETWEEN SETTING A PAGE UP AND BUILDING IT. A handler that answers
// without waiting on anything is `async` all the same, so it lands a microtask after the call that
// started it — and a body built in the same breath as the setup painted it as a hole every time.
// What is asserted is the markup the server sent, and that nothing was set up twice to get it.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const HANDLERS = `import { GET } from 'abide/server'

let setups = 0

// Held, and answered from what it holds: nothing to wait on but its own \`async\`.
export const getInvoice = GET(async ({ id }: { id: string }) => {
    setups += 1
    return { id, setups }
})

// Waits on the clock, which no turn is long enough for: still a hole, filled by the browser (41.4).
export const getSlow = GET(async () => {
    await new Promise((done) => setTimeout(done, 200))
    return 'late'
})
`

// THE PAGE IS UNDER A LAYOUT, which is the case the build order made hardest: the page used to be set
// up inside the layout's markup, after every chance to wait had passed.
const LAYOUT = `<main><slot/></main>`

const PAGE = `<script>
import { reactive } from 'abide'
import { getInvoice, getSlow } from '#server/rpc/invoices.ts'

const invoice = reactive(() => getInvoice({ id: '4021' }))
const slow = reactive(() => getSlow())
</script>

<p id="invoice">{invoice().id} {invoice().setups}</p><p id="slow">{slow()}</p>`

let stop = (): void => {}
let base = ''

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/layout.abide': LAYOUT,
        'ui/pages/page.abide': PAGE,
        'server/rpc/invoices.ts': HANDLERS,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
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
