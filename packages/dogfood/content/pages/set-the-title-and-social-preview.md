---
title: Set the title and social preview
nav: Head & metadata
intent: Per-page titles and metadata, and whether a correct one is worth waiting for.
covers:
  - `<head>`
---

A `<head>` element in a `.abide` file contributes its children to the document head. It is
markup rather than a call, so what a page adds to the head sits in the page, next to the values
it is built from.

```abide #ui/pages/invoices/[id]/page.abide — excerpt
<head>
    <title>Invoice {route.params.id}</title>
    <meta name="description" content={invoice.summary}/>
</head>
```

## Where it may go, and how two of them merge

A `<head>` element is **top level** in the file and never inside a control block. Contributions
are hoisted at compile time, so what the head can contain is decided by the build rather than
discovered by running the page — which is what makes the head knowable before any value has
landed.

| | |
| --- | --- |
| two contributions with the same key | the **deepest** one wins |
| a contribution with no merge key | appended, in tree order |

So a layout's `<title>` is the app's default and a page's replaces it, with neither knowing
about the other. A `<link>` or a `<script>` with nothing to key on appends instead, because two
of those are usually both wanted.

Read on: [Layouts](give-pages-the-same-chrome.md)

## Nothing in the head holds the flush by default

The head goes out with the page once it is built, and a value still in flight does **not** delay it.
That is the whole reason a title can be wrong for a moment: the alternative is a blank tab
while the invoice loads, and a blank tab is worse.

Nothing is opt-in here either: a `<title>` is a sink like any other, and it fills when the value
lands. Metadata a crawler reads — which does not come back for the second version — is the one
case that wants the value before the first flush, and that is the server's business rather than
the head's.

```abide #ui/pages/invoices/[id]/page.abide — excerpt
<head>
    <title>Invoice {invoice.reference}</title>
</head>
```

Read on: [Streaming HTML](send-the-page-before-the-data-lands.md) ·
[Request to paint](../start/how-a-page-becomes-html.md)

## On a client navigation, keys replace and a layout does not move

The incoming page's keyed contributions replace the outgoing page's **by key**. A layout's
contributions do not move at all, the layout not having been rebuilt — so the app's icon and
its font preloads are declared once and never touched again.

A key only the outgoing page set goes back to the layout's value, else to the shell's, and is
removed where neither has one. The tab ends on the title a fresh load of that address shows.

Read on: [Links & navigation](link-to-another-page.md)

## Next

* [Streaming HTML](send-the-page-before-the-data-lands.md) — what else the flush does not wait for
* [Layouts](give-pages-the-same-chrome.md) — where an app-wide default belongs
* [Manual rendering](render-a-document-yourself.md) — the document a head is merged into
