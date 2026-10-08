---
title: Reuse a piece of markup
nav: Components
intent: A component in the same file or its own, the children a caller passes into it, and markup it fills in.
covers:
  - `props`
  - `Attributes<Tag>`
  - `children`
  - `{#component Name(pattern)}`
  - `<Name/>`
  - `<Tag>…</Tag>`
  - `<slot>fallback</slot>`
examples:
  - packages/dogfood/examples/props-live.json
---

A component is a `.abide` file, or a block in one. Invoking it is a capitalised tag, and that
capital is the whole of the distinction — `<Row/>` is yours and `<row/>` is the element.

## The four spellings

| You write | What it is |
| --- | --- |
| `<Name/>` | an invocation of a component |
| `<Tag>…</Tag>` | the same, with children passed into it |
| `{#component Name(pattern)}` | a component declared inline, where it is used |
| `<slot/>` / `<slot>fallback</slot>` | where children render, and what renders without them |

## A component declared where it is used

An inline component is TitleCase like any other, and it exists for the piece of markup that is
worth naming but not worth a file — a row in one table, a cell shape used twice on one page.
The parentheses hold the pattern a `props()` call would destructure, and an annotation on it is
that call's type argument:

```abide #ui/pages/contacts/[id]/page.abide — excerpt
{#component Field({ label, value }: { label: string; value: string })}
    <li><span>{label}</span><strong>{value}</strong></li>
{/component}

<ul class="fields">
    <Field label="email" value={contact.email}/>
    <Field label="phone" value={contact.phone}/>
</ul>
```

It can be written anywhere markup can: at the top of the file, inside an element, in an `{#if}`
arm or a `{#for}` row, or inside another inline component. It is invocable anywhere in the block
it is written in, before it included, and nowhere outside that block.

**It closes over where it is written.** A value the file's `<script>` declares is read by name
inside it, and live, the same as anywhere else in the template. Declared in a row, it reads that
row's item without being handed it:

```abide #ui/pages/contacts/page.abide — excerpt
<script>
import { reactive } from 'abide'
import { listContacts } from '#server/contacts.ts'
import type { Contact } from '#shared/Contact.ts'

const contacts = listContacts()
let masked = reactive(true)
</script>

<ul>
    {#for contact of contacts by contact.id}
        {#component Phone()}
            <strong>{masked ? '••• ••••' : contact.phone}</strong>
        {/component}
        <li><span>{contact.name}</span><Phone/></li>
    {/for}
</ul>
```

Setting `masked` rewrites each `<strong>` in place. Its own `<script>` is set up once per
invocation, its own `<style>` reaches only what it writes, and the file's `<style>` reaches it too.

## Markup a component fills in

An inline component written directly between a component's tags is **passed to it as a prop** of
the same name. The component declares that prop as a function of the props it hands over, and
invokes it by name:

```abide #ui/components/ContactTable.abide
<script>
import { props } from 'abide'
import type { Contact } from '#shared/Contact.ts'

const { contacts, Row } = props<{
    contacts: Contact[]
    Row: (props: { contact: Contact }) => unknown
}>()
</script>

<table>
    <tbody>
        {#for contact of contacts by contact.id}
            <tr><Row contact={contact}/></tr>
        {/for}
    </tbody>
</table>
<slot/>
```

```abide #ui/pages/contacts/page.abide — excerpt
<ContactTable contacts={contacts}>
    {#component Row({ contact }: { contact: Contact })}
        <td>{contact.name}</td><td>{masked ? '••• ••••' : contact.phone}</td>
    {/component}
    <p>{contacts.length} contacts</p>
</ContactTable>
```

The table decides where each row goes and the page decides what is in it, reading its own
`masked` as it does. Anything else between the tags is still `children`, for the `<slot/>`. The
passed component is the prop and nothing more: it is not in scope anywhere else on the page.
`abide check` holds its pattern to the type the table declares, so a row shaped differently is
an error at the `{#component}`.

## A prop is a live read

{% example props-live %}

*1 declaration, 0 update calls* — the arm hands the child a reader and then owns the job of
telling it when.

`props()` hands back **one accessor per key**, and a prop declared as a plain type is a live
read of the caller's expression rather than a snapshot of it. So the child re-reads when the
parent's value moves, and neither of them arranges that: the parent does not call the child
again, and the child does not subscribe to anything by name.

You declare every prop as the type of its value, never as a `Reactive`. A child may write one
by name, and the caller decides where the write goes: `bind:` sends it to the caller's value,
and without `bind:` it stays in the child until the caller's expression changes.

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

## `Attributes<Tag>` types what you pass on to an element

A component that wraps a `<button>` usually declares the few props it reads itself and spreads
the rest onto the element. `Attributes<'button'>` types that rest as what a `<button>` takes, so
a caller is held to the element's own attributes and its `onclick` is handed a `MouseEvent`:

```abide #ui/components/Button.abide
<script>
import { props, type Attributes } from 'abide'

const SIZES = { sm: 'px-2 py-1', md: 'px-3 py-2' }

type Props = { size?: keyof typeof SIZES } & Attributes<'button'>

const { size = 'md', ...attributes } = props<Props>()
</script>

<button class={SIZES[size]} {...attributes}><slot/></button>
```

`<Button type="submit" disabled>` checks, and `<Button type="banana">` does not. The types come
from the DOM types TypeScript ships, so there is no list of attributes to keep up to date, and a
value is typed by what writes the attribute rather than by the DOM property behind it:
`tabindex="-1"` and `aria-disabled={true}` are both fine.

An SVG element works the same way: `Attributes<'svg'>` or `Attributes<'path'>` types `viewBox`,
`d`, `stroke-width` and the rest of SVG's attributes, so an icon component can pass them through.

## Next

* [Scripts](run-code-when-a-component-loads.md) — what runs per instance and what runs once
* [Styles](scope-styles-to-a-component.md) — a component's own CSS, scoped to it
* [Events](respond-to-a-click.md) — why `onsave` on a component is a prop
