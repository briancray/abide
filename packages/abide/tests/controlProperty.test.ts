// 32.113-32.115 — A FORM CONTROL'S `value`, `checked` AND `selected` ARE ITS PROPERTIES. An attribute
// is the control's DEFAULT: a `<textarea>` never shows its `value` attribute, and an `<input>` or an
// `<option>` stops following its attribute once the reader has typed, clicked or picked. So a value
// written only as an attribute (32.37) left a draft set in code out of a `<textarea>`, and a field
// typed in showing what was typed after the value had moved on.
//
// THE REVERTS, each structural rather than installable — the write is chosen by the compiler per
// element and by `bindSpread` once per element, and `writeControl` is a module binding:
// - make `writeControl` return at once: the three browser tests fail, each on a property still
//   holding what the reader left there ('typed', a box left unchecked).
// - drop `spreadTexts` and the `within` for a dynamic `value` in `renderMarkup`: the server's
//   `<textarea>`s render empty, and both markup assertions report it.
// - drop 32.115's arm in `refuseBinds`: the textarea compiles.
import { afterAll, expect, test } from 'bun:test'

import { parseAbide } from '#compiler'
import { flushSync } from '#shared'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

const reader = () => (globalThis as any).__control

// A field the reader typed in: what a dirty control holds.
function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

const SPREAD_PAGE = `<script>
import { reactive } from '@abide/abide'

let text = reactive('first')
let on = reactive(true)
const field = {
    get value() {
        return text()
    },
}
const box = {
    type: 'checkbox',
    get checked() {
        return on()
    },
}
const choice = {
    get selected() {
        return on()
    },
}
;(globalThis as any).__control = {
    setText: (next: string) => { text = next },
    setOn: (next: boolean) => { on = next },
}
</script>

<form><textarea id="area" {...field}></textarea><input id="line" {...field}><input id="box" {...box}><select id="pick"><option id="a">a</option><option id="b" {...choice}>b</option></select></form>`

test('a spread value is a textarea’s text on the server and its property in the browser — 32.113, 32.114', async () => {
    const { html, mount } = await renderPage(SPREAD_PAGE)
    expect(html).toContain(
        '<textarea id="area" value="first">\nfirst</textarea>',
    )
    mount()
    const area = document.getElementById('area') as HTMLTextAreaElement
    const line = document.getElementById('line') as HTMLInputElement
    // Hydration writes no property whose attribute the server already wrote (32.113), and happy-dom
    // keeps the newline after `<textarea>` that a browser's parser drops.
    expect(area.value.replace(/^\n/, '')).toBe('first')

    reader().setText('second')
    flushSync()
    expect(area.value).toBe('second')

    typeInto(area, 'typed')
    typeInto(line, 'typed')
    reader().setText('')
    flushSync()
    expect(area.value).toBe('')
    expect(line.value).toBe('')
    expect(line.getAttribute('value')).toBe('')
})

test('a spread checked and selected follow after the reader has changed them — 32.113', async () => {
    await mountPage(SPREAD_PAGE)
    const box = document.getElementById('box') as HTMLInputElement
    const b = document.getElementById('b') as HTMLOptionElement
    const a = document.getElementById('a') as HTMLOptionElement
    expect(box.checked).toBe(true)
    expect(b.selected).toBe(true)

    box.click()
    a.selected = true
    flushSync()
    expect(box.checked).toBe(false)
    reader().setOn(false)
    flushSync()
    reader().setOn(true)
    flushSync()
    expect(box.checked).toBe(true)
    expect(b.selected).toBe(true)
})

const NAMED_PAGE = `<script>
import { reactive } from '@abide/abide'

let text = reactive('first')
let on = reactive(true)
let rows = reactive([{ id: 1, text: 'row one' }])
;(globalThis as any).__control = {
    setText: (next: string) => { text = next },
    setOn: (next: boolean) => { on = next },
    addRow: () => { rows = [...rows, { id: 2, text: 'row two' }] },
}
</script>

<form><textarea id="area" value={text}></textarea><input id="line" value={text}><input id="box" type="checkbox" checked={on}>{#for row of rows key row.id}<textarea id={'r' + row.id} value={row.text}></textarea>{/for}</form>`

test('a named value is a textarea’s text, and follows a typed-in field — 32.113, 32.114', async () => {
    const { html, mount } = await renderPage(NAMED_PAGE)
    expect(html).toContain(
        '<textarea id="area" value="first">\nfirst</textarea>',
    )
    mount()
    const area = document.getElementById('area') as HTMLTextAreaElement
    const line = document.getElementById('line') as HTMLInputElement
    const box = document.getElementById('box') as HTMLInputElement

    typeInto(area, 'typed')
    typeInto(line, 'typed')
    box.click()
    reader().setText('set in code')
    reader().setOn(false)
    flushSync()
    reader().setOn(true)
    flushSync()
    expect(area.value).toBe('set in code')
    expect(line.value).toBe('set in code')
    expect(box.checked).toBe(true)

    // A row the browser builds shows its value too.
    reader().addRow()
    flushSync()
    expect((document.getElementById('r2') as HTMLTextAreaElement).value).toBe(
        'row two',
    )
})

const TYPED_PAGE = `<script>
import { reactive } from '@abide/abide'

let amount = reactive(0)
let spreadAmount = reactive(0)
const field = {
    get value() {
        return spreadAmount()
    },
    oninput: (event: Event) => {
        spreadAmount = Number((event.target as HTMLInputElement).value)
    },
}
;(globalThis as any).__control = {
    setAmount: (next: number) => { amount = next },
    setSpreadAmount: (next: number) => { spreadAmount = next },
}
</script>

<form><input id="named" value={amount} oninput={(event) => amount = Number(event.target.value)}><input id="spread" {...field}></form>`

// THE REVERT: drop the compare by number in `writeControl` and both fields read `1` where the
// reader typed `1.`.
test('a control is written where its value moves, not where it reads differently from what was typed — 32.113', async () => {
    await mountPage(TYPED_PAGE)
    for (const [id, set] of [
        ['named', (next: number) => reader().setAmount(next)],
        ['spread', (next: number) => reader().setSpreadAmount(next)],
    ] as const) {
        const input = document.getElementById(id) as HTMLInputElement
        // `1.` writes 1, and 1 is not what the field shows — but it is what the reader meant.
        typeInto(input, '1.')
        expect(input.value).toBe('1.')
        expect(input.getAttribute('value')).toBe('1')
        // The value moving to what it already was writes nothing.
        set(1)
        flushSync()
        expect(input.value).toBe('1.')
        // A keystroke landing on the value already written leaves the field as typed too.
        typeInto(input, '1.5')
        typeInto(input, '1.50')
        expect(input.value).toBe('1.50')
        // A value moved in code is written.
        set(7)
        flushSync()
        expect(input.value).toBe('7')
        // And one moved back to what the reader had typed, after it moved away, is written.
        typeInto(input, '1.50')
        set(2)
        flushSync()
        set(1.5)
        flushSync()
        expect(input.value).toBe('1.5')
    }
})

const RERUN_PAGE = `<script>
import { reactive } from '@abide/abide'

let draft = reactive('set')
let tick = reactive(0)
const field = {
    get value() {
        return draft()
    },
    get title() {
        return String(tick())
    },
}
;(globalThis as any).__control = {
    tick: () => { tick = tick + 1 },
    setDraft: (next: string) => { draft = next },
}
</script>

<form><input id="named" value={tick >= 0 ? draft : ''}><input id="spread" {...field}></form>`

// THE REVERT: write the property on every rerun — `writeControl` unguarded in `setControl` and in
// `bindSpread` — and both fields read `set` where the reader typed `typed`.
test('a rerun that writes the text already written leaves what the reader typed — 32.113', async () => {
    await mountPage(RERUN_PAGE)
    const named = document.getElementById('named') as HTMLInputElement
    const spread = document.getElementById('spread') as HTMLInputElement
    typeInto(named, 'typed')
    typeInto(spread, 'typed')
    reader().tick()
    flushSync()
    expect(named.value).toBe('typed')
    expect(spread.value).toBe('typed')
    reader().setDraft('moved')
    flushSync()
    expect(named.value).toBe('moved')
    expect(spread.value).toBe('moved')
})

test('a textarea with a value and text of its own is refused — 32.115', () => {
    const refusedFor = (template: string): string => {
        try {
            parseAbide(template)
        } catch (thrown) {
            return (thrown as Error).message
        }
        return 'compiled'
    }
    expect(refusedFor('<textarea value={draft}>b</textarea>')).toContain(
        'RULEBOOK 32.115',
    )
    expect(refusedFor('<textarea value={draft}></textarea>')).toBe('compiled')
})
