---
title: Animate from one page to the next
nav: View transitions
intent: View transitions, turned on by the stylesheet that describes them and nothing else.
covers:
  - `view-transition-name`
---

A view transition is a browser feature, and abide's part in it is to get out of the way: write
the CSS that describes the transition and it happens. There is no option to turn on, because
the rule you wrote **is** the option.

## The stylesheet is the switch

```abide #ui/pages/invoices/[id]/page.abide — excerpt
<style>
.invoice-total {
    view-transition-name: invoice-total;
}
</style>
```

Naming an element is what makes the browser animate it from where it was on the outgoing page
to where it is on the incoming one. A `::view-transition-old` or `::view-transition-new`
selector does the same job for the whole document.

Whether an app uses transitions at all is decided at **build time**, from the compiled `<style>`
blocks. It is not a runtime walk of the document's stylesheets — that walk would run on every
navigation of every app, including every app that has never wanted one.

## The transition is awaited to the DOM write, not to the end

The navigation waits for the point the **DOM is written**, and not for the animation to finish.
That is the difference between a transition and a delay: an app whose transition is 400ms is
not an app whose every navigation takes 400ms, and the values the incoming page loads are
already in flight while it plays.

## A browser without support navigates as it otherwise would

There is nothing to feature-detect. A browser with no `view-transition-name` support renders
the incoming page the way it would have with no rule at all, and an app is not asked to write
the fallback — the fallback is the behaviour the rule was an enhancement to.

Read on: [Links & navigation](link-to-another-page.md)

## Next

* [Links & navigation](link-to-another-page.md) — what starts one of these
* [Layouts](give-pages-the-same-chrome.md) — the part of the document that does not transition
* [Styles](../templates/scope-styles-to-a-component.md) — where the rule is written
