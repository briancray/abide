// 35.15, 35.16, 35.17 — THE ROOT LAYOUT WRITES THE DOCUMENT: written inside `<html>`, its `<head>`
// is a head block, its `<body>` the template, and the attributes of the two are the document's own
// — rendered by the server onto the document it sends and bound by the client on the document's
// own `<html>` and `<body>`, as on any element.

import { afterAll, expect, test } from 'bun:test'

import { parseAbide } from '#compiler'
import { compileApp } from '#compiler/compileApp.ts'
import { emitSource } from '#compiler/emitSource.ts'
import { render } from '#server'
import { placement } from '#server/placement.ts'
import { flushSync } from '#shared'

import { servedModules } from './servedModules.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import {
    closeTyped,
    refusal,
    renderPage,
    TYPED_ROOT,
    typedSession,
} from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

const DOCUMENT = `<script>
import { reactive } from '@abide/abide'

let dark = reactive(false)
</script>

<html lang="en">
<head><title>Ledger</title></head>
<body class={dark ? 'dark' : 'light'}>
    <button onclick={() => dark = !dark}>flip</button>
</body>
</html>`

// 35.15, 35.17 — A STATIC ATTRIBUTE IS WRITTEN AND A LIVE ONE BOUND. THE REVERTS: drop the
// `file.document` binding from `emitClient`; the click leaves the body `light`. Return the document
// unchanged from `withDocumentAttributes`; the server writes neither `lang` nor `class`.
test("the root layout's <html> and <body> attributes are the document's, live — 35.15, 35.17", async () => {
    const { html, mount } = await renderPage(DOCUMENT)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<body class="light">')
    expect(html).toContain('<title>Ledger</title>')
    expect(html.match(/<body/g)?.length).toBe(1)
    document.body.className = 'light'
    mount()
    ;(document.querySelector('button') as HTMLElement).click()
    flushSync()
    expect(document.body.className).toBe('dark')
})

// 35.16 — THE DOCUMENT IS WRITTEN ONCE, AROUND EVERYTHING ELSE. THE REVERTS: drop the `html` and
// `body` tags from `assertNoNestedHead`, the after-loop check in `parseAbide`, or the child check in
// `documentOf`; each source below then parses.
test('an <html> or <body> anywhere but around the whole file is refused — 35.16', () => {
    for (const source of [
        '<div><body></body></div>',
        '<p>beside</p>\n<html><head></head><body></body></html>',
        '<html><head></head><div></div><body></body></html>',
        '<html><head></head></html>',
    ])
        expect(() => parseAbide(source)).toThrow('RULEBOOK 35.16')
})

// 35.16 — ONLY THE ROOT LAYOUT. THE REVERT: drop the document check from `compileApp`'s emit loop;
// the section layout builds with a second document inside the first.
test('a document written by any file but the root layout is refused — 35.16', async () => {
    const refused = await refusal(
        compileApp(
            temporaryModule({
                'package.json': JSON.stringify({
                    name: 'document-fixture',
                    type: 'module',
                }),
                'layout.abide':
                    '<html><head></head><body><slot/></body></html>',
                'media/layout.abide':
                    '<html><head></head><body><slot/></body></html>',
                'media/index.abide': '<p>media</p>',
            }),
        ),
    )
    expect(refused).toContain('35.16')
    expect(refused).toContain('media/layout.abide')
})

// An invoice as its own document, as a handler renders one to send.
const INVOICE = `<script>
import { props } from '@abide/abide'

const { number } = props<{ number: string }>()
</script>

<html lang="en">
<body class="invoice"><h1>Invoice {number}</h1></body>
</html>`

// 35.6, 35.15 — A COMPONENT HANDED TO `render` WRITES THE DOCUMENT it is rendered into, as the root
// layout writes a page's. THE REVERT: emit `document` only for a page or a layout in
// `emitComponent`; the bytes carry neither `lang` nor the body's class.
test('a component rendered on its own writes the document — 35.6, 35.15', async () => {
    const file = parseAbide(INVOICE)
    const reads = await (
        await typedSession()
    ).reads(`${TYPED_ROOT}src/Invoice.abide`, file)
    const emitted = emitSource({
        ...placement('lib/Invoice.abide'),
        file,
        answer: reads,
        invoked: true,
    })
    const dir = servedModules({
        'Invoice.abide': {
            server: emitted.server,
            client: emitted.client,
        },
    })
    const { default: Invoice } = await import(`${dir}/Invoice.abide`)
    const html = new TextDecoder().decode(
        await render(Invoice({ number: 'INV-4021' })),
    )
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<body class="invoice">')
    expect(html).toContain('<h1>Invoice INV-4021</h1>')
    expect(html.match(/<meta charset/g)?.length).toBe(1)
})

// 35.16 — A DOCUMENT IS THE OUTERMOST COMPONENT'S, so one placed inside another is refused where it
// renders — a tag or a chosen component alike. THE REVERT: drop the `document` check from
// `renderComponent`; the page renders, with the invoice's `<html>` attributes nowhere.
test('a component that writes <html>, placed inside another, is refused — 35.16', async () => {
    const refused = await refusal(
        renderPage(
            `<script>
import Invoice from './Invoice.abide'
</script>

<Invoice number="INV-4021"/>`,
            { Invoice: INVOICE },
        ),
    )
    expect(refused).toContain('RULEBOOK 35.16')
})
