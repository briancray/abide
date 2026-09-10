---
title: Reuse a piece of markup
nav: Components
intent: A component in the same file or its own, and the children a caller passes into it.
covers:
  - `props`
  - `children`
  - `{#component Name(pattern)}`
  - `<Name/>`
  - `<Tag>…</Tag>`
  - `<slot>fallback</slot>`
examples:
  - packages/dogfood/examples/props-live
---

A component is a `.abide` file, or a block in one. Invoking it is a capitalised tag, and that
capital is the whole of the distinction — `<Row/>` is yours and `<row/>` is the element.

## The four spellings

| You write | What it is |
| --- | --- |
| `<Name/>` | an invocation of a component |
| `<Tag>…</Tag>` | the same, with children passed into it |
| `{#component Name(pattern)}` | a component declared inline, in the file that uses it |
| `<slot/>` / `<slot>fallback</slot>` | where children render, and what renders without them |

An inline component is TitleCase like any other, and it exists for the piece of markup that is
worth naming but not worth a file — a row in one table, a cell shape used twice on one page.
Moving it into a file later changes the import and nothing else.

## A prop is a live read

{% example props-live %}

*1 declaration, 0 update calls* — the arm hands the child a reader and then owns the job of
telling it when.

`props()` hands back **one accessor per key**, and a prop declared as a plain type is a live
read of the caller's expression rather than a snapshot of it. So the child re-reads when the
parent's value moves, and neither of them arranges that: the parent does not call the child
again, and the child does not subscribe to anything by name.

A prop declared as a plain type has **no `Reactive` face at all** — not a `Reactive` with the
write removed, which would be a type that looks writable at every site that has one. Declaring
it as a `Reactive` instead passes the caller's own through unchanged, and then `bind:` becomes
a compile requirement at every call site, because a child that can write is a child every
caller has to have agreed to.

Destructuring keeps every binding live, and the pattern is **flat**: renames, defaults and a
rest element, and no nested patterns. The rest element is live too, one accessor per key the
call site actually passed.

Read on: [Values by name](read-and-write-a-value-by-name.md) ·
[Form binding](bind-a-form-to-state.md)

## A component with no `props` call accepts none

There is no implicit bag. A component that never calls `props()` takes no props of its own, and
a caller passing one is an error rather than a value that goes nowhere. That is the failure this
replaces: a typo in a prop name is otherwise a component quietly rendering its default.

`props()` with no type argument hands back an untyped record, and that is the opt-out rather
than the default. It is also callable from a `<script>` block only: a `<script module>` block
runs once for the module and has no instance to read props of, so calling it there is a compile
error.

## `children` is always accepted and never declared

Whatever a caller puts between the tags arrives as `children`, and `<slot/>` is where it
renders. `<slot>fallback</slot>` renders the fallback where a caller passed none, which is how
a panel has a default body without the caller having to know what it is:

```abide #ui/components/Panel.abide
<script>
import { props } from 'abide'

const { title } = props<{ title: string }>()
</script>

<li><span>{title}</span><strong><slot>none yet</slot></strong></li>
```

```abide #ui/pages/contacts/[id]/page.abide — excerpt
<ul class="fields">
    <Panel title="phone">+1 415 555 0132</Panel>
    <Panel title="notes"/>
</ul>
```

`children` is never declared because declaring it would make it a prop, and then a component
would have two ways to receive the same thing with different rules.

## `{...expr}` spreads, and an explicit prop wins

A spread on a component spreads props. An **explicit** prop beats a spread whatever the source
order, so a default set and one override read the same either way round. Two spreads against
each other resolve in source order, there being nothing else to separate them.

Read on: [Expressions](put-a-value-in-the-markup.md)

## Next

* [Scripts](run-code-when-a-component-loads.md) — what runs per instance and what runs once
* [Styles](scope-styles-to-a-component.md) — a component's own CSS, scoped to it
* [Events](respond-to-a-click.md) — why `onsave` on a component is a prop
