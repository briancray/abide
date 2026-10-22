// 32.5, 32.7, 32.8 — AN ELEMENT'S PROPERTY AND A VALUE, KEPT IN STEP BOTH WAYS: the server writes the
// value standing at render into the tag, and the client binds the property where the server left it.

import { afterAll, expect, test } from 'bun:test'
import { emitClient, parseAbide } from '#compiler'
import { flushSync } from '#shared'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, mountPage, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

const PAGE = `<script>
import { reactive } from '@abide/abide'

let name = reactive('ada')
let age = reactive(36)
let subscribed = reactive(true)
let size = reactive('m')
let toppings = reactive(['cheese'])
let open = reactive(false)
</script>

<input id="name" bind:value={name}>
<input id="age" type="number" bind:value={age}>
<input id="subscribed" type="checkbox" bind:checked={subscribed}>
<input id="s" type="radio" value="s" bind:group={size}>
<input id="m" type="radio" value="m" bind:group={size}>
<input id="cheese" type="checkbox" value="cheese" bind:group={toppings}>
<input id="olives" type="checkbox" value="olives" bind:group={toppings}>
<details id="more" bind:open={open}><summary>more</summary></details>
<p id="out">{name} {age} {subscribed} {size} {toppings.join(',')} {open}</p>`

async function mounted(): Promise<string> {
    return (await mountPage(PAGE)).html
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement
const out = () => document.getElementById('out')?.textContent

// 32.5, 32.7, 32.8 — THE SERVER WRITES WHAT STANDS AT RENDER, as the attribute each property
// reflects, and writes no `bind:` attribute at all. THE REVERT: drop the `bound` arm from
// `classifyAttributes`; the tag carries `bind:value="ada"` and no `value`.
test('the server writes a bind as the attribute its property reflects — 32.5, 32.7', async () => {
    const html = await mounted()
    expect(html).toContain('<input id="name" value="ada">')
    expect(html).toContain('<input id="subscribed" type="checkbox" checked>')
    expect(html).toContain('<input id="m" type="radio" value="m" checked>')
    expect(html).toContain('<input id="s" type="radio" value="s">')
    expect(html).toContain(
        '<input id="cheese" type="checkbox" value="cheese" checked>',
    )
    expect(html).not.toContain('bind:')
})

// 32.5 — THE READER'S INPUT IS WRITTEN BACK, and a number stays a number; the value's own writes move
// the property. THE REVERT: drop the listener from `bindProperty`; typing leaves the value at "ada".
test('bind:value reads the property and writes it back on input — 32.5', async () => {
    await mounted()
    const name = input('name')
    name.value = 'grace'
    name.dispatchEvent(new Event('input'))
    const age = input('age')
    age.value = '40'
    age.dispatchEvent(new Event('input'))
    flushSync()
    expect(out()).toStartWith('grace 40 ')
})

// 32.7 — A BOOLEAN BIND IS A BOOLEAN, both ways.
// 32.5, 31.8 — A PATH INTO A VALUE IS WRITTEN THROUGH, as `contact.address.city = v` is: the binding
// is handed the path's read and its write. THE REVERT: drop `boundPath` from `Lowering.reference`;
// the binding is handed the city as a string, and what is typed never reaches the value.
test('bind:value on a path into a value writes the path — 32.5, 31.8', async () => {
    const { html } = await mountPage(`<script>
import { reactive } from '@abide/abide'

let contact = reactive({ name: 'Ada', address: { city: 'London' } })
</script>

<input id="city" bind:value={contact.address.city}>
<p id="out">{contact.name} {contact.address.city}</p>`)
    expect(html).toContain('value="London"')
    input('city').value = 'Paris'
    input('city').dispatchEvent(new Event('input'))
    flushSync()
    expect(out()).toBe('Ada Paris')
})

test('bind:checked and bind:open are booleans both ways — 32.7', async () => {
    await mounted()
    const box = input('subscribed')
    expect(box.checked).toBe(true)
    box.checked = false
    box.dispatchEvent(new Event('change'))
    const details = document.getElementById('more') as HTMLDetailsElement
    details.open = true
    details.dispatchEvent(new Event('toggle'))
    flushSync()
    expect(out()).toContain(' false m cheese true')
    expect(box.hasAttribute('checked')).toBe(false)
})

// 32.8 — A GROUP COMPARES AGAINST EACH INPUT'S OWN VALUE: a radio group holds the one chosen, and a
// checkbox group the list of those checked, in the order they were.
test('bind:group holds the radio chosen, or the boxes checked — 32.8', async () => {
    await mounted()
    const small = input('s')
    small.checked = true
    small.dispatchEvent(new Event('change'))
    const olives = input('olives')
    olives.checked = true
    olives.dispatchEvent(new Event('change'))
    flushSync()
    expect(out()).toContain(' s cheese,olives ')
    expect(input('m').checked).toBe(false)
    expect(input('s').getAttribute('group')).toBeNull()
})

const SPREAD = `<script>
import { reactive } from '@abide/abide'

let attrs = reactive<Record<string, unknown>>({ title: 'first', 'data-kind': 'card', hidden: false, id: 'ignored' })
</script>

<div id="card" {...attrs}>card</div>
<button id="swap" onclick={() => { attrs = { title: 'second', hidden: true } }}>swap</button>`

// 32.11 — AN ELEMENT'S SPREAD IS WRITTEN BY THE SERVER AND KEPT WRITTEN BY THE CLIENT: a key the tag
// names itself is the tag's, `false` writes nothing, `true` is bare, and a key the value stops
// carrying is removed. THE REVERT: skip `removeAttribute` in `bindSpread`; `data-kind` outlives the
// value that carried it.
test('a spread writes attributes, and keeps them in step with the value — 32.11', async () => {
    const { html, mount } = await renderPage(SPREAD)
    expect(html).toContain(
        '<div id="card" title="first" data-kind="card">card</div>',
    )
    mount()
    ;(document.getElementById('swap') as HTMLElement).click()
    flushSync()
    const card = document.getElementById('card') as HTMLElement
    expect(card.getAttribute('title')).toBe('second')
    expect(card.hasAttribute('hidden')).toBe(true)
    expect(card.hasAttribute('data-kind')).toBe(false)
})

const SPREAD_LISTENERS = `<script>
import { reactive } from '@abide/abide'

const heard = (globalThis as unknown as { heard: string[] }).heard
let attrs = reactive<Record<string, unknown>>({ onClick: () => heard.push('first'), onfocus: 'text' })
</script>

<p id="target" {...attrs}>target</p>
<button id="next" onclick={() => { attrs = { onclick: () => heard.push('second') } }}>next</button>
<button id="none" onclick={() => { attrs = {} }}>none</button>`

// 32.11 — A FUNCTION UNDER \`on<event>\` IS A LISTENER, any case, replaced when the value hands over
// another and removed when it stops carrying one. THE REVERT: skip \`removeEventListener\` in
// \`bindSpread\`; the click after \`none\` is heard as 'second' again.
//
// 32.4 — A NON-FUNCTION UNDER \`on<event>\` IS NEITHER A LISTENER NOR MARKUP, on the server or the
// client: a string there written as an attribute is an inline handler, script compiled from data.
// THE REVERT: let a non-function \`on<event>\` member fall through to \`attributeText\` in
// \`spreadEntries\`; the server writes \`onfocus="text"\` into the tag.
test('a spread binds its on<event> functions as listeners, and keeps them in step — 32.11', async () => {
    const heard: string[] = []
    ;(globalThis as unknown as { heard: string[] }).heard = heard
    const { html, mount } = await renderPage(SPREAD_LISTENERS)
    expect(html).toContain('<p id="target">target</p>')
    mount()
    const target = document.getElementById('target') as HTMLElement
    expect(target.hasAttribute('onfocus')).toBe(false)
    target.click()
    ;(document.getElementById('next') as HTMLElement).click()
    flushSync()
    target.click()
    ;(document.getElementById('none') as HTMLElement).click()
    flushSync()
    target.click()
    expect(heard).toEqual(['first', 'second'])
})

const NUMERIC = `<script>
import { reactive } from '@abide/abide'

let price = reactive<number | undefined>(1)
</script>

<input id="price" bind:value={price}>
<p id="out">{typeof price} {price}</p>`

const type = (field: HTMLInputElement, text: string) => {
    field.value = text
    field.dispatchEvent(new Event('input'))
    flushSync()
}

// 32.59 — TEXT THAT READS AS THE VALUE IS LEFT AS TYPED: `2.` is a decimal point on its way, and
// `0.10` a trailing zero the reader put there. THE REVERT: drop the `numberFromText` early return
// from `bindValue`'s watch; the field reads `2` after `2.` is typed.
test('a numeric bind leaves text that already reads as the value — 32.59', async () => {
    await mountPage(NUMERIC)
    const price = input('price')
    type(price, '2.')
    expect(price.value).toBe('2.')
    type(price, '2.5')
    expect(out()).toBe('number 2.5')
    type(price, '0.10')
    expect(price.value).toBe('0.10')
    expect(out()).toBe('number 0.1')
})

// 32.58 — A BLANK FIELD IS `undefined`, AND THE BIND STAYS NUMERIC: the digit typed after it is a
// number, and text that reads as none writes nothing. THE REVERT: decide `numeric` from the
// standing value at each write, as the listener did; `5` after a blank is written as the string.
test('a numeric bind writes undefined for a blank field and stays numeric — 32.58', async () => {
    await mountPage(NUMERIC)
    const price = input('price')
    type(price, '')
    expect(out()).toBe('undefined ')
    type(price, '-')
    expect(out()).toBe('undefined ')
    expect(price.value).toBe('-')
    type(price, '5')
    expect(out()).toBe('number 5')
})

// 32.60 — A COMPOSITION IS ONE WRITE, on its end. THE REVERT: drop the `composing` check from the
// `input` listener; the value reads the half-composed `k` before the composition ends.
test('bind:value writes once when a composition ends — 32.60', async () => {
    await mountPage(PAGE)
    const name = input('name')
    name.dispatchEvent(new Event('compositionstart'))
    type(name, 'k')
    expect(out()).toStartWith('ada ')
    name.value = 'か'
    name.dispatchEvent(new Event('compositionend'))
    flushSync()
    expect(out()).toStartWith('か ')
})

const CHOOSE = `<script>
import { reactive } from '@abide/abide'

let note = reactive('first\\n<b>')
let size = reactive(2)
let sizes = [1, 2, 3]
let tags = reactive(['a', 'c'])
</script>

<textarea id="note" bind:value={note}></textarea>
<select id="size" bind:value={size}>{#for one of sizes}<option value={one}>{one}</option>{/for}</select>
<select id="tags" multiple bind:value={tags}><option>a</option><option value="b">b</option><option>c</option></select>
<p id="out">{tags.join(',')}</p>`

// 32.61 — THE PAINTED PAGE CARRIES THE VALUE before a script runs: a textarea's as its text, a
// select's as `selected` on the option it selects, however the option was rendered. THE REVERT:
// drop the `within` arms from `renderPosition`; the textarea renders empty and no option is
// selected.
test('the server writes a textarea text and a select option selected — 32.61', async () => {
    const { html } = await renderPage(CHOOSE)
    expect(html).toContain('<textarea id="note">\nfirst\n&lt;b&gt;</textarea>')
    expect(html).toContain('<option value="2" selected>2</option>')
    expect(html).not.toContain('<option value="1" selected>')
    expect(html).toContain('<option selected>a</option>')
    expect(html).toContain('<option value="b">b</option>')
    expect(html).toContain('<option selected>c</option>')
})

// 32.62 — A `<select multiple>` HOLDS A LIST: what is selected, read and written per option. THE
// REVERT: drop the `multiple` arm from `bindValue`; the watch writes the list as the select's one
// value, `a,c`, which no option has, and hydration deselects both options the server selected.
test('bind:value on a select multiple holds the selected values — 32.62', async () => {
    await mountPage(CHOOSE)
    const tags = document.getElementById('tags') as HTMLSelectElement
    const options = tags.options
    expect([...options].map((option) => option.selected)).toEqual([
        true,
        false,
        true,
    ])
    ;(options[0] as HTMLOptionElement).selected = false
    ;(options[1] as HTMLOptionElement).selected = true
    tags.dispatchEvent(new Event('change'))
    flushSync()
    expect(out()).toBe('b,c')
})

const LATE = `<script>
import { reactive } from '@abide/abide'

let size = reactive(2)
let tags = reactive(['b'])
let sizes = reactive([1])
let letters = reactive(['a'])
</script>

<select id="size" bind:value={size}>{#for one of sizes}<option value={one}>{one}</option>{/for}</select>
<select id="tags" multiple bind:value={tags}>{#for one of letters}<option>{one}</option>{/for}</select>
<button id="grow" onclick={() => ((sizes = [1, 2]), (letters = ['a', 'b']))}>grow</button>`

// 32.62 — AN OPTION THAT ARRIVES AFTER THE VALUE IS SELECTED WHEN IT IS THE VALUE: the value's
// watch reads no option, so nothing else wakes for one. THE REVERT: drop `chooseOnNewOptions` from
// `bindValue`; the select stays on `1` and the multiple one selects nothing.
test('an option that arrives after the value is selected — 32.62', async () => {
    await mountPage(LATE)
    document.getElementById('grow')?.click()
    flushSync()
    // The observer reports on a microtask.
    await Bun.sleep(0)
    expect((document.getElementById('size') as HTMLSelectElement).value).toBe(
        '2',
    )
    const tags = document.getElementById('tags') as HTMLSelectElement
    expect([...tags.options].map((option) => option.selected)).toEqual([
        false,
        true,
    ])
})

// 32.8 — A GROUP COMPARES AGAINST THE INPUT'S OWN VALUE WHEREVER IT COMES FROM, an expression
// included: a radio list built from data is served with its chosen option checked, a number stays a
// number in the group, and a value that moves rechecks its input.
//
// THE REVERTS: compare against `'on'` for a `value={expr}` in `boundMarkup`, and the served page
// checks nothing — this reports `null` where `2` is due; compare against the element's `value`
// property in `bindGroup`, and the moved value never checks `#moving` — `false` where `true` is due.
test('bind:group compares against a value={expr} — 32.8', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let choice = reactive(2)
const options = [{ id: 1 }, { id: 2 }, { id: 3 }]
let size = reactive('m')
let mine = reactive('s')
</script>

<main>{#for option of options by option.id}<input id={'o' + option.id} type="radio" name="o" value={option.id} bind:group={choice}>{/for}
<input id="moving" type="radio" value={mine} bind:group={size}>
<button id="move" onclick={() => { mine = 'm' }}>move</button>
<p id="out">{typeof choice} {choice}</p></main>`)
    expect(html.match(/id="o(\d)"[^>]* checked/)?.[1] ?? null).toBe('2')
    mount()
    flushSync()
    input('o3').click()
    flushSync()
    expect(out()).toBe('number 3')
    expect(input('moving').checked).toBe(false)
    ;(document.getElementById('move') as HTMLElement).click()
    flushSync()
    expect(input('moving').checked).toBe(true)
})

// 32.72 — A BIND AND SOMETHING ELSE WRITING ONE VALUE IS REFUSED. The server wrote both — two
// `value=` attributes, or two `<option selected>` — and the browser kept whichever came first, and
// the client moved with whichever wrote last.
//
// THE REVERT: drop the `refuseTwoOwners` call from `classifyAttributes`, and every one of these
// compiles.
test('a bind beside another writer of its value is refused — 32.72', () => {
    const refusedFor = (template: string): string => {
        try {
            emitClient(parseAbide(template))
        } catch (thrown) {
            return (thrown as Error).message
        }
        return 'compiled'
    }
    for (const template of [
        '<input type="checkbox" bind:checked={on} checked={other}>',
        '<input type="checkbox" bind:checked={on} checked>',
        '<input bind:value={name} value={other}>',
        '<input bind:value={name} value="ada">',
        '<input type="radio" value="a" bind:group={pick} checked>',
        '<details bind:open={open} open></details>',
        '<select bind:value={size}><option value="s" selected>s</option></select>',
        '<select bind:value={size}>{#if wide}<option value="l" selected={big}>l</option>{/if}</select>',
        '<textarea bind:value={text}>draft</textarea>',
    ])
        expect(refusedFor(template)).toContain('RULEBOOK 32.72')
    // NOT ONE OWNER'S VALUE: a group's `value` is what it compares against, and a select with no
    // `selected` is the bind's alone.
    expect(
        refusedFor('<input type="radio" value={id} bind:group={pick}>'),
    ).toBe('compiled')
    expect(
        refusedFor(
            '<select bind:value={size}><option value="s">s</option></select>',
        ),
    ).toBe('compiled')
})
