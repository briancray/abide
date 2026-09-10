---
title: Give pages the same chrome
nav: Layouts
intent: A header, a sidebar and a footer that do not rebuild when the page under them changes.
covers:
  - `src/ui/pages/**/layout.abide`
  - `<slot/>`
---

A `layout.abide` beside a page wraps it. Every page under that directory renders inside it, and
a navigation between two of them changes what is in the slot and nothing around it.

## A layout is a component with a slot

```abide #ui/pages/layout.abide
<script>
import { principal } from 'abide'
</script>

<header>
    <a href="/">Ledger</a>
    <span>{principal.resolved.name}</span>
</header>

<main><slot/></main>
```

`<slot/>` is where the child page renders, and it is the same `<slot/>` any component has.
There is no layout API and no second kind of component: a layout is the component the router
puts a page inside.

Layouts **nest**. A `layout.abide` at `pages/` and another at `pages/invoices/` means an
invoice page renders inside both, outermost first, which is how a section gets its own sidebar
without the app's header being mentioned twice.

Read on: [Components](../templates/reuse-a-piece-of-markup.md)

## What a layout buys is what it does not rebuild

The reason to put chrome in a layout rather than in each page is not that it saves typing. It
is that a shared layout is **not rebuilt** across a navigation: the header keeps its scroll
position, an open menu stays open, and a component in the sidebar that was mid-load is still
mid-load.

A page that renders its own header gets none of that, and the symptom is subtle — everything
looks right, and a menu closes itself every time somebody follows a link.

Read on: [Links & navigation](link-to-another-page.md) ·
[View transitions](animate-from-one-page-to-the-next.md)

## A layout reads the route it wraps

`route.params` and `route.name` are ambient, so a layout reads them without a page passing
anything down. That is what a breadcrumb wants, and what a sidebar highlighting the current
section wants.

Read on: [Routes](add-a-page.md)

## Next

* [Routes](add-a-page.md) — the file that becomes the page in the slot
* [Head & metadata](set-the-title-and-social-preview.md) — what a layout contributes to the head
* [Error pages](show-a-page-when-something-fails.md) — resolved the same nearest-ancestor way
