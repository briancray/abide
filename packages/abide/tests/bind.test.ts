// 32.5, 32.7, 32.8 — AN ELEMENT'S PROPERTY AND A VALUE, KEPT IN STEP BOTH WAYS: the server writes the
// value standing at render into the tag, and the client binds the property where the server left it.

import { afterAll, expect, test } from 'bun:test'
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
