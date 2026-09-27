// 32.6, 32.11, 33.6, 33.12, 33.13 — WHAT AN INVOCATION HANDS ITS CHILD, over a built app (spawned, for
// `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const BADGE = `<script>
import { props } from 'abide'

const { label, tone, size } = props<{ label: string; tone: string; size: string }>()
</script>

<span class="badge">{label}/{tone}/{size}</span>`

const FIELD = `<script>
import { props } from 'abide'

const { value } = props<{ value: string }>()
value = value + ' (touched by the child)'
</script>

<em>{value}</em>`

const ECHO = `<script>
import { props } from 'abide'

const { value } = props<{ value: string }>()
</script>

<b>{value}</b>`

const PAGE = `<script>
import { reactive } from 'abide'
import Badge from '#ui/components/Badge.abide'
import Field from '#ui/components/Field.abide'
import Echo from '#ui/components/Echo.abide'

const first = { label: 'from first', tone: 'first', size: 'first' }
const second = { tone: 'second' }
let note = reactive('typed')
let kept = reactive('kept')
</script>

<main>
<p id="a"><Badge size="explicit" {...first} {...second}/></p>
<p id="field"><Field bind:value={note}/></p>
<p id="note">{note}</p>
<p id="echo"><Echo bind:value={note}/></p>
<p id="unbound"><Field value={kept}/></p>
<p id="kept">{kept}</p>
</main>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'ui/components/Badge.abide': BADGE,
        'ui/components/Field.abide': FIELD,
        'ui/components/Echo.abide': ECHO,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 33.12, 33.13 — AN EXPLICIT PROP BEATS EVERY SPREAD WHEREVER IT STANDS, and two spreads resolve in
// source order. THE REVERT: keep the props in source order in `invocationProps`; `size` reads "first".
test('an explicit prop beats a spread, and spreads resolve in order — 33.12, 33.13', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('from first/second/explicit')
})

// 32.6, 33.6 — `bind:prop` HANDS THE CHILD THE CALLER'S OWN `Reactive` behind a prop the child
// declares as a plain `string`, so the child's write by name is the caller's value. THE REVERT:
// build the cell over `read()` rather than `read(true)` in `propCell`; it holds the value instead
// of adopting the `Reactive`, the write stands in the child, and `note` reads "typed".
test("bind:prop hands the child the caller's own Reactive — 32.6, 33.6", async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('<p id="note">typed (touched by the child)</p>')
    expect(html).toContain('<em>typed (touched by the child)</em>')
})

// 32.6, 33.8 — A CHILD THAT ONLY READS A BOUND PROP reads its value: the parent chose `bind:`, and
// nothing about the child changes. THE REVERT: hand back `hold()` from `boundProp` on every call;
// `{value}` renders the `Reactive`'s own source.
test('a bound prop the child only reads is its value — 32.6, 33.8', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('<b>typed (touched by the child)</b>')
})

// 33.7 — A WRITE TO A PROP NOBODY BOUND STANDS IN THE CHILD, and the caller's value is untouched.
// THE REVERT: hand back the caller's accessor from `propCell` instead of a cell; `value = …` has no
// `set` to call and the page fails to render.
test('a write to an unbound prop stands in the child — 33.7', async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('<em>kept (touched by the child)</em>')
    expect(html).toContain('<p id="kept">kept</p>')
})
