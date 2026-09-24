// 32.6, 32.11, 33.7, 33.12, 33.13 — WHAT AN INVOCATION HANDS ITS CHILD, over a built app (spawned, for
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
import { props, type Reactive } from 'abide'

const { value } = props<{ value: Reactive<string> }>()
value.set(value() + ' (touched by the child)')
</script>

<em>{value}</em>`

const PAGE = `<script>
import { reactive } from 'abide'
import Badge from '#ui/components/Badge.abide'
import Field from '#ui/components/Field.abide'

const first = { label: 'from first', tone: 'first', size: 'first' }
const second = { tone: 'second' }
let note = reactive('typed')
</script>

<main>
<p id="a"><Badge size="explicit" {...first} {...second}/></p>
<p id="field"><Field bind:value={note}/></p>
<p id="note">{note}</p>
</main>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'ui/components/Badge.abide': BADGE,
        'ui/components/Field.abide': FIELD,
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

// 32.6, 33.7 — `bind:prop` HANDS THE CHILD THE CALLER'S OWN `Reactive`, so the child's write is the
// caller's value, and the child reads it by name as its own. THE REVERTS: pass `lowering.expression`
// for a `bind:` prop, and the child is handed the string with no `set` to call; or classify a
// `Reactive` prop as a plain one, and `{value}` renders the `Reactive`'s own source.
test("bind:prop hands the child the caller's own Reactive — 32.6, 33.7", async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    expect(html).toContain('<p id="note">typed (touched by the child)</p>')
    // 31.1 — the child reads the prop by name as it reads any `Reactive` of its own.
    expect(html).toContain('<em>typed (touched by the child)</em>')
})
