---
title: Render a document yourself
nav: Manual rendering
intent: Produce HTML outside the page pipeline — an email body, an embed, a static build.
covers:
  - `render`
  - `Component`
  - `Shell`
  - `src/ui/app.html`
---

`render` is what produces a document, and the page pipeline is one caller of it. Reach for it
where you want the same components and not the same request: an email body, an embed somebody
else's page includes, a file written at build time.

```ts #server/rpc/previews.ts — excerpt
import { GET, page, render } from 'abide'
import Invoice from '#ui/components/Invoice.abide'

export const previewInvoice = GET(async ({ id }: { id: string }) =>
    page(render(Invoice({ invoice: await database.invoice.find(id) }))),
)
```

## `render` takes a component already bound to its props

`Invoice({ invoice })` is a `Component` — the component **bound to its props**, not invoked and
not rendered. That is what makes the signature one argument rather than two, and what keeps the
props typed at the binding site rather than as an untyped bag handed alongside.

It produces an **async generator of bytes**. That is the same thing the page pipeline streams,
so a caller that wants the document whole awaits it and a caller that wants to stream it hands
it to `page` — and `page` takes it directly, because `Values<T>` covers a generator.

Read on: [Response types](../server/answer-with-something-other-than-json.md) ·
[Components](../templates/reuse-a-piece-of-markup.md)

## `Shell` is the document it renders into

```ts shared
type Shell = string | URL | undefined
```

The shell defaults to `src/ui/app.html`, which is the document an app's pages are served in. A
`string` is a document inline, a `URL` is one to read, and leaving it out gets the app's own.

An email body wants a different shell — no bundle, no font preloads, inline styles — and that
is the whole of what asking for one means. Nothing else about the render changes.

## `src/ui/app.html` is the app's own shell

It is a real HTML file rather than a template with a syntax of its own. What abide contributes
to it is the head merging, the mount meta and the bundle, and what you contribute is everything
else — a `lang`, a favicon, an analytics tag you would rather not have in a component.

Read on: [Head & metadata](set-the-title-and-social-preview.md) ·
[Sub-path mounting](serve-the-app-under-a-sub-path.md)

## Next

* [Streaming HTML](send-the-page-before-the-data-lands.md) — what the produced stream does
* [Response types](../server/answer-with-something-other-than-json.md) — `page`, and what else a handler can return
* [Request to paint](../start/how-a-page-becomes-html.md) — where the page pipeline calls this
