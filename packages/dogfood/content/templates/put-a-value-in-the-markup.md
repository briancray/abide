---
title: Put a value in the markup
nav: Expressions
intent: Text, attributes, classes and inline styles that follow a value.
covers:
  - `{expr}`
  - `{await expr}`
  - `{raw(...)}`
  - `name={expr}`
  - `name="…{expr}…"`
  - `{...expr}`
  - `class:name={cond}`
  - `style:prop={value}`
examples:
  - packages/dogfood/examples/markup-escaped
  - packages/dogfood/examples/markup-class-style
---

A hole in the markup is `{}` around an expression. Whatever it reads, it follows: the text
updates, the attribute updates, the class comes and goes. There is no second step where you
tell the page that something changed.

## Where a hole can go

| You write | Where it lands |
| --- | --- |
| `{expr}` | a text node, escaped |
| `{raw(expr)}` | a text node, as markup |
| `{await expr}` | a text node, after the expression resolves |
| `name={expr}` | one attribute or property, whole |
| `name="…{expr}…"` | one attribute, interpolated into a string |
| `class:name={cond}` | one class |
| `style:prop={value}` | one style property |
| `{...expr}` | every attribute on an element, every prop on a component |

Each of them updates the **one thing it names** and nothing around it. That is the difference
between a hole and a re-render: a class arriving does not touch the other classes, and an
attribute changing does not rebuild the element.

## Text is escaped, and `raw` is the way out

{% example markup-escaped %}

*2 holes, 1 default* — and the arm's default is the other one.

`{expr}` renders escaped text, so a value carrying `<b>` is those five characters on the page.
That is the direction worth having as the default: a note field, a search term and an error
message from somewhere else all reach a hole eventually, and only one of them has to be
hostile.

`{raw(expr)}` is the opt-out, spelled at the site rather than configured. It is the one place
in a template where a value becomes markup, so it is also the only place to look when asking
whether it could.

## An attribute follows its value, whole or interpolated

`href={invoice.url}` sets the attribute from the whole expression. `class="row {status}"` mixes
a literal with a hole, and the interpolation is the value's — not a string you assembled and
the DOM parsed back.

An interpolation in a **URL-typed** attribute is scheme-checked. A scheme outside `http:`,
`https:`, `mailto:` and `tel:`, or a relative reference, is dropped and warned on
`abide:render` — so a `javascript:` that reached an `href` through a record somebody else wrote
does not become a listener.

An interpolated `style` attribute is a special case worth knowing: it lowers to `style:prop`
under a static property name rather than being built as a string, so setting one property
never rewrites the others.

Read on: [Handler URLs](../server/find-the-url-a-handler-answers-on.md)

## `class:` and `style:` set one name each

{% example markup-class-style %}

The condition decides whether the class is there. Everything else in `class=` stays where it
was, which is what makes a component's own class and a state-driven one able to live on the
same element without either knowing about the other.

`style:prop` is the same bargain for one CSS property. A measured width, a transform from a
value, a colour from a status — each is one property assignment, and the rest of the element's
inline style is not a string this had to rebuild.

Read on: [Styles](scope-styles-to-a-component.md)

## `{...expr}` spreads

On an element it spreads attributes; on a component it spreads props. An **explicit** prop
beats a spread whatever the source order, so `<Row {...defaults} tone="urgent"/>` and
`<Row tone="urgent" {...defaults}/>` are both urgent. Two spreads against each other resolve in
source order, there being nothing else to separate them.

Read on: [Components](reuse-a-piece-of-markup.md)

## `{await expr}` holds the render

`{await invoice.total}` blocks rendering until the expression resolves, and it governs the
**whole** expression rather than the nearest operand. Reads inside one are started before they
are awaited, so two of them in a single hole are one round trip and not two.

It is the blunt instrument, and most pages want the other one: `{#await}` gives you a branch to
render while the value is still coming, which is a page a reader can look at rather than a page
that is not there yet.

Read on: [Conditionals](show-markup-conditionally.md) ·
[Loading states](../values/show-a-value-that-isnt-there-yet.md)

## Next

* [Values by name](read-and-write-a-value-by-name.md) — what the name in the hole means
* [Conditionals](show-markup-conditionally.md) — a branch instead of a value
* [Lists](repeat-markup-over-a-list.md) — a hole repeated over a collection
