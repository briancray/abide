---
title: Send the page before the data lands
nav: Streaming HTML
intent: Flush the document early and fill the holes as the values arrive.
covers:
  - `href={x}`, any attribute
  - `class:`, `style:`, `bind:`
  - `<title>{name}</title>`
  - `<textarea>{v}</textarea>`
---

The document is **not held for the data**. The head goes out as soon as it is known, the markup
follows as far as it goes, and every value still in flight leaves a hole that fills when it
lands. Nothing is opted into: this is what a render does.

## A hole in the page is a sink

A **sink** is a hole the render leaves where a value is still in flight, for the browser to
fill once that value lands. It is how markup can be sent past a value that has not arrived — the
bytes around it go now, and the document closes when the walk is done. The browser's own call
fills the hole, and nothing is written into the document to do it.

| The hole | What is filled |
| --- | --- |
| `href={x}`, any attribute | the attribute or property, on the element itself |
| `class:`, `style:`, `bind:` | the class, the style property, the bound property |
| `<title>{name}</title>` | the element's `.textContent` |
| `<textarea>{v}</textarea>` | the element's `.defaultValue` |

An attribute sink fills **on the element**, not by re-emitting markup around it. That matters
for the same reason `class:` and `style:` matter anywhere: one attribute is written and the
rest of the element is untouched, so a value arriving late cannot disturb an attribute that
arrived on time.

## RCDATA fills through the property

`<title>` and `<textarea>` hold **RCDATA** — text where markup does not parse — so a sink
inside one fills through the element's own property rather than through markup. Writing markup
into a `<title>` would either be shown as characters or close the element early, and neither is
what the page meant.

That is why `<textarea>` fills `defaultValue` rather than `value`: it is the *initial* content
the markup was describing, and a reader who has already typed into it has not lost what they
typed.

Read on: [Head & metadata](set-the-title-and-social-preview.md) ·
[Form binding](../templates/bind-a-form-to-state.md)

## The batching unit is the turn

A sink fill batches by **turn**, not by production. A value that produces ten times in one turn is
one write, not ten — so a stream arriving faster than the page can paint does not turn into ten
times the work.

Read on: [Streaming data](../server/send-data-as-it-arrives.md)

## Nothing holds the flush but one turn

Not a hole, not the head, not the `<script>`. The document is a stream, and a value that has not
arrived is a hole in it. There is no form that turns one back into a wait — which is what makes
"the page goes out first" a property rather than a default you keep choosing.

The one wait is abide's, and it is a single turn. The page and its layouts are set up, the loads
they started get that turn to answer, and then the markup is built. A value already held, or a
handler with nothing to wait on, is painted rather than left as a hole. Anything that waits on the
network or a timer is not waited for.

The case that wants otherwise is metadata a crawler reads, which does not come back for the
second version. That value has to be there before the render starts, and getting it there is the
server's problem — not a spelling in the template.

Read on: [Request to paint](../start/how-a-page-becomes-html.md) ·
[Loading states](../values/show-a-value-that-isnt-there-yet.md)

## Next

* [Request to paint](../start/how-a-page-becomes-html.md) — the whole sequence this is one stage of
* [Manual rendering](render-a-document-yourself.md) — producing the same stream yourself
* [Head & metadata](set-the-title-and-social-preview.md) — the one place holding earns its cost
