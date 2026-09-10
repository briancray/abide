---
title: Send the page before the data lands
nav: Streaming HTML
intent: Flush the document early and fill the holes as the values arrive.
covers:
  - `href={await x}`, any attribute
  - `class:`, `style:`, `bind:`
  - `<title>{name}</title>`
  - `<textarea>{v}</textarea>`
---

The document is **not held for the data**. The head goes out as soon as it is known, the markup
follows as far as it goes, and every value still in flight leaves a hole that fills when it
lands. Nothing is opted into: this is what a render does.

## A hole in the stream is a sink

A **sink** is an addressable hole in the output stream that a value still in flight fills
later. It is how markup can be sent past a value that has not arrived — the bytes around it go
now, and the value is written into the place it left.

| The hole | What is filled |
| --- | --- |
| `href={await x}`, any attribute | the attribute or property, on the element itself |
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

## The batching unit is the flush

A sink fill batches by **flush**, not by production. A value that produces ten times before the
next flush is one write, not ten — so a stream arriving faster than the connection does not
turn into ten times the bytes.

Read on: [Streaming data](../server/send-data-as-it-arrives.md)

## What holds the flush is spelled

Nothing holds it by default, including the head. Holding is `{await}` around the expression,
spelled the same way it is spelled anywhere else, and it is worth reaching for in one place:
metadata a crawler reads, which does not come back for the second version.

Read on: [Request to paint](../start/how-a-page-becomes-html.md) ·
[Loading states](../values/show-a-value-that-isnt-there-yet.md)

## Next

* [Request to paint](../start/how-a-page-becomes-html.md) — the whole sequence this is one stage of
* [Manual rendering](render-a-document-yourself.md) — producing the same stream yourself
* [Head & metadata](set-the-title-and-social-preview.md) — the one place holding earns its cost
