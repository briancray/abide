---
title: Pages and navigation
nav: Overview
intent: A file is a route, and the parts of its path in brackets are values you can read.
---

A file is a route. The parts of the path in brackets become values you can read.

| File | Serves |
| --- | --- |
| `#ui/pages/invoices/page.abide` | `/invoices` |
| `#ui/pages/invoices/[id]/page.abide` | `/invoices/42`, as `route.params.id` |
| `#ui/pages/layout.abide` | the chrome for everything below it |
| `#ui/pages/error.abide` | where a failure renders, 404 included |

```abide abide
<a href={url('/invoices/[id]', { id })}>See more</a>
```

## Adding a page

The file is the route, so there is no table to keep in step with the filesystem. The
same app can be served under a sub-path without a link being rewritten.

Read on: [Routes](add-a-page.md) ·
[Sub-path mounting](serve-the-app-under-a-sub-path.md)

## Layouts that do not rebuild

A layout wraps the pages nested under it and does not rebuild when the page inside it
changes.

Read on: [Layouts](give-pages-the-same-chrome.md)

## Moving from one page to another

`url()` builds an address that survives a rename and a mount path, so a link is checked
rather than typed. A view transition is turned on by the stylesheet that describes it.

Read on: [Links & navigation](link-to-another-page.md) ·
[View transitions](animate-from-one-page-to-the-next.md)

## When a page fails

A failure renders in one place, and 404 reaches it the same way everything else does
rather than being a case of its own.

Read on: [Error pages](show-a-page-when-something-fails.md)

## Streaming the document before the data

The document can be flushed before the data lands, with the holes filling as values
arrive — and the title and social preview are their own decision about what is worth
waiting for.

Read on: [Streaming HTML](send-the-page-before-the-data-lands.md) ·
[Head & metadata](set-the-title-and-social-preview.md) ·
[Manual rendering](render-a-document-yourself.md)
