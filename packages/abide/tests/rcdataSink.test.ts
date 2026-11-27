// 35.9 — A SINK INSIDE RCDATA FILLS THROUGH THE ELEMENT'S OWN PROPERTY. A `<textarea>`'s and a
// `<title>`'s content is RCDATA: the parser reads it as text, so a comment anchor written there is
// shown as text, and markup written there is shown as its source.

import { afterAll, expect, test } from 'bun:test'

import { flushSync } from '#shared'

import { closeTyped, renderPage } from './typed.ts'

afterAll(closeTyped)

test('a textarea bound to a value renders that value as its text, and no anchor — 35.9', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let note = reactive('Wants a three-year term.')
</script>

<main><textarea id="note">{note}</textarea></main>`)
    expect(html).toContain(
        '<textarea id="note">Wants a three-year term.</textarea>',
    )
    mount()
    flushSync()
    const box = document.querySelector('#note') as HTMLTextAreaElement
    expect(box.defaultValue).toBe('Wants a three-year term.')
})

test('a textarea whose value lands late is filled through defaultValue — 35.9', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

const note = reactive(() => Promise.resolve('Signed in March.'))
</script>

<main><textarea id="late">{note}</textarea></main>`)
    expect(html).toContain('<textarea id="late"></textarea>')
    mount()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
    const box = document.querySelector('#late') as HTMLTextAreaElement
    expect(box.defaultValue).toBe('Signed in March.')
})

// THE REVERT: set no expression's `rcdata` (parseAbide); the server writes the raw run's
// anchors inside the textarea, shown as text, and the client parses the markup away — `false, 'bold'`
// where `true, '<b>bold</b>'` is due.
test('a raw value in a textarea is its source as text, on the server and once hydrated — 35.9', async () => {
    const { html, mount } = await renderPage(`<script>
import { raw, reactive } from '@abide/abide'

let draft = reactive(raw('<b>bold</b>'))
</script>

<main><textarea id="raw">{draft}</textarea></main>`)
    mount()
    flushSync()
    const box = document.querySelector('#raw') as HTMLTextAreaElement
    expect([
        html.includes('<textarea id="raw">&lt;b&gt;bold&lt;/b&gt;</textarea>'),
        box.defaultValue,
    ]).toEqual([true, '<b>bold</b>'])
})
