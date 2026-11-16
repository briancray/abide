// 32.4, 32.95, 39.21, 39.22, 39.23 — AN `on<event>` VALUE IS A LISTENER AND ITS OPTIONS, on an element and on the
// two targets a component listens on without rendering anything: `<window>` and `<document>`.

import { afterAll, expect, test } from 'bun:test'

import { emitClient, parseAbide } from '#compiler'
import { flushSync } from '#shared'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage, refusal, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

const LISTENED = `<script>
import { reactive } from '@abide/abide'

let shown = reactive(0)
function seen() {
    shown = shown + 1
}
function heard() {
    const counted = globalThis as { heard?: number }
    counted.heard = (counted.heard ?? 0) + 1
}
</script>

<window onkeydown={() => heard()}/>
<document onvisibilitychange={seen}></document>
<p id="out">{shown}</p>`

const out = () => document.getElementById('out')?.textContent
const heard = () => (globalThis as { heard?: number }).heard ?? 0

// 39.23 — ADDED AT MOUNT, REMOVED WHEN THE COMPONENT LEAVES: the window outlives the component, so
// a listener left on it would keep running for a component nothing shows. THE REVERT: drop
// `, ${SCOPE}` from `listenerCall`'s target arm; the keydown after `stop` still runs — `2` where `1`
// is due.
test('a <window> listener is added at mount and removed when the component leaves — 39.23', async () => {
    const { scope } = await mountPage(LISTENED)
    const before = heard()
    dispatchEvent(new KeyboardEvent('keydown'))
    document.dispatchEvent(new Event('visibilitychange'))
    flushSync()
    expect(out()).toBe('1')
    scope.stop()
    dispatchEvent(new KeyboardEvent('keydown'))
    expect(heard() - before).toBe(1)
})

// 39.21 — SKIPPED ON THE SERVER: nothing is written where the tag stands, and the listener is never
// evaluated there. THE REVERT: push a `<window>` into `template` in `parseAbide`; the document holds
// `<window>` and its `onkeydown` is dropped as a listener the server cannot write.
test('a <window> or a <document> renders nothing on the server — 39.21', async () => {
    const { html } = await renderPage(LISTENED)
    expect(html).not.toContain('<window')
    expect(html).not.toContain('<document')
    expect(html).toContain('<p id="out">0</p>')
})

// 39.21, 39.22 — WHERE IT STANDS AND WHAT IT HOLDS. THE REVERTS: drop the `isListenerTarget` arm of
// `assertNoNestedHead`, and the nested one compiles (to an element named `window`); drop the
// attribute loop in `listenerTarget`, and the class compiles to nothing at all.
test('a <window> anywhere but the top level, or holding anything but listeners, is a build error — 39.21, 39.22', () => {
    const refused = (source: string): string => {
        try {
            parseAbide(source)
        } catch (thrown) {
            return String(thrown)
        }
        return ''
    }
    expect(refused('<div><window onkeydown={() => {}}/></div>')).toContain(
        'RULEBOOK 39.21',
    )
    expect(refused('{#if true}<document onclick={() => {}}/>{/if}')).toContain(
        'RULEBOOK 39.21',
    )
    expect(
        refused('{#component Row()}<window onkeydown={() => {}}/>{/component}'),
    ).toContain('RULEBOOK 39.21')
    expect(refused('<window class="x"/>')).toContain('RULEBOOK 39.22')
    expect(refused('<window onkeydown="go()"/>')).toContain('RULEBOOK 39.22')
    expect(refused('<window {...handlers}/>')).toContain('RULEBOOK 39.22')
    expect(refused('<document>text</document>')).toContain('RULEBOOK 39.22')
    expect(
        refused('<html><body><window onkeydown={() => {}}/></body></html>'),
    ).toBe('')
})

const OPTIONED = `<script>
import { reactive } from '@abide/abide'

let clicks = reactive(0)
const once = {
    handleEvent() {
        clicks = clicks + 1
    },
    once: true,
}
const spread = { onclick: once }
</script>

<button id="written" onclick={once}>a</button>
<button id="spread" {...spread}>b</button>
<p id="out">{clicks}</p>`

// 32.95 — AN `EventListenerObject`'S FIELDS ARE ITS OPTIONS, written or spread: `once` takes the first
// click and no other. THE REVERT: hand `addEventListener` the listener alone in `listen`; each
// button counts both clicks — `4` where `2` is due.
test('an on<event> object listener carries its options, written or spread — 32.95', async () => {
    await mountPage(OPTIONED)
    for (const id of ['written', 'spread', 'written', 'spread'])
        document.getElementById(id)?.click()
    flushSync()
    expect(out()).toBe('2')
})

// 32.95 — A FUNCTION WRITTEN IN PLACE EMITS WHAT IT DID BEFORE OPTIONS WERE TAKEN: no `listen`
// imported, and the call `addEventListener(type, fn)` byte for byte. THE REVERT: drop the
// `isFunctionLiteral` arm of `listenerCall`; every listener below goes through `__listen` and the
// module imports it — 5 `__listen` where 0 are due. (Measured with this arm in: a page of written
// functions emits the same bytes as before, and an `onclick={save}` 13 more unminified, 3 fewer minified.)
test('a function written in place costs no byte more for listeners taking options — 32.95', () => {
    const client = emitClient(
        parseAbide(`<script>
let n = 0
</script>
<button onclick={() => n++}>a</button>
<button onclick={(event) => n++}>b</button>
<button onclick={event => n++}>c</button>
<button onclick={async function () { n++ }}>d</button>`),
    )
    expect(client.match(/__listen/g)?.length ?? 0).toBe(0)
    expect(client.match(/\.addEventListener\("click", /g)?.length).toBe(4)
    expect(client).toContain('.addEventListener("click", () => n++)')
})

// 39.21 — and a refusal through the whole pipeline names the clause, for `refusal`'s callers.
test('a nested <document> is refused where the page is built — 39.21', async () => {
    expect(
        await refusal(mountPage('<p><document onclick={() => {}}/></p>')),
    ).toContain('RULEBOOK 39.21')
})
