// 41.28 AND 41.25 — A CHILD IS PAINTED AS A PAGE IS. A call a child's setup made
// that answers within the turn is in the server's markup, a grandchild's too, and the head marks a
// call settled exactly where the markup was built from it settled. The output a browser hydrates
// is what is asserted: an arm painted is an arm the early-call script must agree with.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { handlerFiles, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// `getTick` needs one microtask, which a component built where it is called never gives it;
// `getSlow` needs a timer, which no render waits for (41.4).
const TOTALS = `import { GET } from '@abide/abide/server'

export const getTick = GET(async ({ id }: { id: string }) => {
    await Promise.resolve()
    return { id, total: 2 }
})

export const getSlow = GET(async ({ id }: { id: string }) => {
    await new Promise((done) => setTimeout(done, 20))
    return { id, total: 3 }
})
`

const child = (call: string, title: string): string => `<script>
import { reactive } from '@abide/abide'
import call from '#src/totals/${call}.handler.ts'
import Grand from './Grand.abide'

const total = reactive(() => call({ id: '${call}' }))
</script>

<head><title>${title}</title></head>
<p class="${call}">{total.busy() ? 'loading' : total().total}</p><Grand />`

const GRAND = `<script>
import { reactive } from '@abide/abide'
import getTick from '#src/totals/getTick.handler.ts'

const total = reactive(() => getTick({ id: 'grand' }))
</script>

<b>{total.busy() ? 'loading' : total().total}</b>`

const PAGE = `<script>
import Plain from './lib/Plain.abide'
import Slow from './lib/Slow.abide'
import Tick from './lib/Tick.abide'
</script>

<main><Tick /><Slow /><Plain /></main>`

// A CALL MADE WHILE THE MARKUP IS BUILT, not in a setup: nothing defers it, so it is painted in
// flight and answers a microtask after.
const INLINE = `<script>
import getTick from '#src/totals/getTick.handler.ts'
</script>

<main><p>{getTick({ id: 'inline' }).busy() ? 'loading' : 'done'}</p></main>`

// A BARE PROBE IN MARKUP reads every load in its scope, so it is built once the siblings after it
// have been set up — as the browser's is, where every setup has run before a region chooses.
const FLAG = `<script>
import { busy } from '@abide/abide'
</script>

<p id="flag">{#if busy()}busy{:else}idle{/if}</p>`

const FLAG_FIRST = `<script>
import Flag from '../lib/Flag.abide'
import Slow from '../lib/Slow.abide'
</script>

<main><Flag /><Slow /></main>`

let stop = (): void => {}
let base = ''

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'index.abide': PAGE,
        'inline/index.abide': INLINE,
        'flagfirst/index.abide': FLAG_FIRST,
        'lib/Flag.abide': FLAG,
        'lib/Tick.abide': child('getTick', 'tick'),
        'lib/Slow.abide': child('getSlow', 'slow'),
        'lib/Grand.abide': GRAND,
        // No setup, so nothing to defer: built where it stands, after two children that were not.
        'lib/Plain.abide': '<head><title>plain</title></head><i>plain</i>',
        ...handlerFiles('totals', TOTALS),
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

async function page(address: string): Promise<string> {
    return (await Bun.fetch(`${base}${address}`)).text()
}

// Each call's row in the head, by its id, as `1` where it is marked painted settled.
function marks(html: string): Record<string, boolean> {
    const rows = JSON.parse(
        /<script type="application\/json">([\s\S]*?)<\/script>/.exec(
            html,
        )?.[1] ?? '[]',
    ) as unknown[][]
    const marked: Record<string, boolean> = {}
    for (const row of rows)
        marked[String(row[1]).split('id=').pop() ?? ''] = row[3] === 1
    return marked
}

// THE REVERT: emit every component as it was — `waits` false in `emitComponent` — and the child's
// `<p>` and every `<b>` read `loading`, the calls that answered a microtask later.
test('a call a child makes is painted where it answers within the turn — 41.28', async () => {
    const html = await page('/')
    expect(html).toContain('<p class="getTick">2</p>')
    expect(html).toContain('<p class="getSlow">loading</p>')
    // A grandchild set up only once its parent built is given a turn of its own.
    expect(html.match(/<b>2<\/b>/g)).toHaveLength(2)
    expect(html).not.toContain('<b>loading</b>')
    expect(html).not.toContain('\u0000')
})

// THE REVERT: mark in `earlyCallScript` from what each call holds as the head is written; `inline`
// reads `true` — settled a microtask after the markup painted it loading, so hydration would choose
// the arm the server never painted.
test('the head marks a call settled only where the markup was built from it settled — 41.25', async () => {
    expect(marks(await page('/'))).toEqual({
        getTick: true,
        getSlow: false,
        grand: true,
    })
    const inline = await page('/inline')
    expect(inline).toContain('<p>loading</p>')
    expect(marks(inline)).toEqual({ inline: false })
})

// 39.4, 39.11 — a deferred child's head lands where its marker stood, so the tree's order holds and
// the last `<title>` is the last contributor's — `Plain`, built where it stands after two children
// that deferred. THE REVERT: push a deferred child's head onto `heads` when it is built rather than
// a marker where it stands; the document's title reads `slow`.
test("a deferred child's head keeps its place in the tree's order — 39.4", async () => {
    const html = await page('/')
    expect(html.match(/<title>[^<]*<\/title>/g)).toEqual([
        '<title>plain</title>',
    ])
})

// 41.28 — A BARE `busy` IN A CHILD'S MARKUP ANSWERS OVER ITS LATER SIBLINGS' LOADS, as the browser's
// does at hydration (41.27), so the arm the server paints is the one the client chooses. THE
// REVERT: drop `probes` from `emitComponent`; `Flag` builds where it is called, before `Slow` has
// started its call, and paints `idle` where `busy` is due — the arm hydration then rebuilds (41.24).
test('a bare busy in a child answers over the loads its later siblings start — 41.28', async () => {
    expect(await page('/flagfirst')).toContain(
        '<p id="flag"><!--[0-->busy<!--]--></p>',
    )
})
