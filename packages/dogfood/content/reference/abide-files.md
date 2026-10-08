---
title: `.abide` files
nav: `.abide` files
intent: The whole template grammar and the by-name rules.
enumerates:
  - Reading and writing by name
  - Templating
  - Props
  - Script / style blocks
  - Tracking
---

A **`.abide`** file is a component: a template, with `<script>` and `<style>` blocks beside it.
Valid TypeScript compiles inside one, and the sugar the file adds sits **over** the explicit
API rather than instead of it — `count` and `count()` are the same read, and both keep
compiling.

## Syntax

```abide abide
<script module>
// module scope
</script>

<script>
// per-instance setup
</script>

<!-- template -->

<style>
/* component-scoped CSS */
</style>
```

Every block is optional and order is free. A file with no `<script>` is markup, which is what a
presentational component usually is.

## Reading and writing by name

| Spelling | Means | Meaning |
| --- | --- | --- |
| `foo` wherever its position is not typed as a `Reactive` | a live read | The name in an expression is the read, unless a template-local binding shadows it. |
| `const x: Reactive<…> = foo` / a `Reactive<…>`-typed parameter, return or `bind:` operand | the `Reactive` | A position whose declared type is a `Reactive` holds. |
| `const [a, b] = foo` / `...foo` | one read | Destructuring and spreading read the value once. |
| `foo = bar` | a write | Assignment is the write, and the value may be settled, a load, or a `Reactive` to adopt. |
| `foo.bar = v` | a write through a path | Copy-on-write down the path, then the write. |
| `foo.push(v)` | the same | A mutator the type resolves writes through the same path. |
| `foo.bar` | the value's `bar` | A property access is a read of the value, and throws `NotLanded` before it lands; a member of the `Reactive` itself reaches the `Reactive`, bound. |
| `foo.bar(…)` | the `Reactive` API where `bar` is a member | A call reaches the `Reactive` where the name is one of its members. |
| `foo()` / `foo.set(v)` | the explicit forms | The two members, which keep compiling. |
| `await foo` | the value, settled | A `Reactive` is a promise for its own settling, so an `await` operand holds it rather than reading it. |
| `refresh(foo)` | the `Reactive` | A `Selection`-typed parameter holds it: a value is never a selection of itself. |


The rule is **position**. An operand, a text hole, an attribute and a value-typed argument are
places a value belongs, so the name reads. A position whose declared type is a
`Reactive` is a place the `Reactive` belongs, so the name holds.

## Templating

### Expressions

| Spelling | Meaning |
| --- | --- |
| `{expr}` | Reactive text, escaped. |

### Expressions

| formatting whitespace | What a run of whitespace renders as. | 33.17, 33.18 |
| --- | --- | --- |
| `{raw(...)}` | Raw HTML. | 32.2 |
| `name={expr}` | A reactive attribute or property. | 32.3, 32.20 |
| `on<event>={fn}` | A native listener on an element, and an ordinary prop on a component. | 32.4 |
| `name="…{expr}…"` | An interpolated quoted value. | 32.3 |
| `bind:value` | Two-way bind on an element. | 5.16, 32.5 |
| `bind:prop={state}` | Hands a component prop the caller's `Reactive`, or a `{get, set}` pair, to write through. | 32.6, 33.6, 33.8, 14.18 |
| `bind:checked` | A boolean bind on an input. | 32.7 |
| `bind:open` | The same, on a `<details>`. | 32.7 |
| `bind:group` | Radio or checkbox membership. | 32.8 |
| `bind:value={{get, set}}` | Two-way bind over an explicit accessor pair, on an element or a component. | 32.5, 32.6 |
| `bind:element={Reactive<Element> \| ((element: Element) => void \| Disposer)}` | A node reference. | 32.9 |
| `class:name={cond}` | Toggles a class. | 32.10 |
| `style:prop={value}` | Sets one style property. | 32.10, 32.19 |
| `{...expr}` | Spreads props or attributes. | 32.11, 33.12, 33.13 |

Static text is markup. An author-written `&amp;` or `&copy;` renders the same in body text and
in an attribute value, and only an interpolated value is escaped — the one exception being a
URL-typed attribute, where the encoding is what stops an entity forming a scheme.

### Raw markup

| Name | Signature | Meaning |
| --- | --- | --- |
| `raw` | `(value: unknown) => Raw` | The branding a value takes to render as markup rather than as text. |
| `Raw` | `class Raw { html: string }` | What `raw` hands back. |

### Control flow

| Spelling | Branches | Meaning |
| --- | --- | --- |
| `{#if cond}` | `{:else if cond}`, `{:else}` | Conditional markup. |
| `{#for item, index of list by key}` | — | Repeats markup over a list, or over a cursor as it produces. |
| `{#try}` | `{:catch e}`, `{:finally}` | A render-time boundary and a region. |

### Components

| Spelling | Meaning |
| --- | --- |
| `{#component Name(pattern)}` | An inline component. |
| `<Name/>` | A component invocation. |
| `<slot/>` | Renders children. |
| `<slot>fallback</slot>` | Renders children, or a fallback. |
| `<Tag>…</Tag>` | Children passed to a component's slot. |


## Props

| Name | Signature | Meaning |
| --- | --- | --- |
| `props` | `<Props>() => { [K in keyof Props]: Props[K] }` | One live accessor per prop the component declares. |
| `Attributes<Tag>` | `Attributes<Tag extends keyof HTMLElementTagNameMap \| keyof SVGElementTagNameMap>` | The attributes an HTML or SVG element takes, typed as a component's props. |
| `children` | always accepted | What a caller passes between the tags. |


`props()` hands back one accessor per key, and a prop declared as a plain type is a **live read**
of the caller's expression with no `Reactive` face at all. Destructuring keeps every binding
live, and the pattern is flat: renames, defaults and a rest element.

## Script and style blocks

| Spelling | Meaning |
| --- | --- |
| `<script>` | Per-instance component setup. |
| `<script module>` | Module scope. |
| `<style>` | Component-scoped styles. |
| `import './app.css'` | A stylesheet the component depends on. |
| `:global(…)` | The per-selector escape from scoping. |


## Tracking

| branch-local `<script>` | no | Setup, once per item. | 14.8 |
| --- | --- | --- | --- |
| `reactive` body, unkeyed | yes | Pushes its own subscriber. | 14.3, 14.11, 14.15, 14.16 |
| `reactive` body, keyed | no | Untracked by handler. | 14.4 |

| block body binding | yes | A live read, like a prop. | 14.5 |
| --- | --- | --- | --- |
| `watch` effect, bare | yes | Pushes its own subscriber. | 14.6, 14.14, 14.16 |
| `watch` effect, over sources | no | The sources decide the reruns. | 12.3, 14.6 |

| event handler | no | Not the flow. | 14.9 |
| --- | --- | --- | --- |
| `Transformer`, `Disposer`, middleware, lifecycle hooks | no | Not the flow. | 14.10 |


A context that tracks re-runs when what it read changes. A context that does not is one where a
read is a read — an event handler runs because something happened, and a setup body runs once —
so nothing is arranged by accident and the arrangement you want is `reactive` or `watch`.

## Description

### Whitespace

A run of whitespace carrying newlines but no space or tab is **dropped wherever it stands**, and
a run that renders nothing but carries a newline and indentation is dropped at both ends of
every block body and of the top-level template. So indentation in a template is layout for the
reader rather than text in the document.

### What the compiler refuses

* A read spelled `foo()` with an argument.
* `props()` from a `<script module>` block.
* A prop passed to a component that never calls `props()`.
* A `Failed` built and discarded as an expression statement.

Each is caught before the code runs, which is why the ergonomic form does not have to be given
up to make the strict one safe.

## Examples

### A component that owns a value

```abide #ui/components/Handle.abide
<script>
import { reactive } from 'abide'

let handle = reactive('ada')
</script>

<h1>@{handle}</h1>
<input bind:value={handle}>
```

### A component with props and children

```abide #ui/components/Panel.abide
<script>
import { props } from 'abide'

const { title } = props<{ title: string }>()
</script>

<li><span>{title}</span><strong><slot>none yet</slot></strong></li>
```

## See also

* [Values by name](../templates/read-and-write-a-value-by-name.md) — the guide to the sugar
* [Expressions](../templates/put-a-value-in-the-markup.md) — the guide to the holes
* [Components](../templates/reuse-a-piece-of-markup.md) — the guide to `props` and slots
