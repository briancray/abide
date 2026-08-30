---
title: Templates
nav: Overview
intent: Reading a value by name in markup, and the four spellings you use every day.
---

Inside a `.abide` file you read a `Reactive` **by name**. The explicit form is what a `.ts`
file writes, and it keeps compiling in a `.abide` script too — the sugar is over it rather
than instead of it.

| In markup | In .ts | Gives you |
| --- | --- | --- |
| `{invoice}` | `invoice()` | the value |
| `{await invoice}` | `await invoice` | the value, once it lands |
| `{#for await row of rows}` | `for await (…of rows)` | each value as it arrives |
| `{#if invoice.pending()}` | `invoice.pending()` | a first load, nothing to show yet |

```abide
<h1>{invoice.number}</h1>
{#if invoice.pending()}
    <p>Loading…</p>
{/if}
```

Those four rows are the part you write every day, not the whole grammar.

## Putting a value into markup

A name in a slot is a live read, not a snapshot taken when the component mounted. The
same name works in text, in an attribute, in a class and in an inline style.

Read on: [State by name](read-and-write-state-by-name.md) ·
[Expressions](put-a-value-in-the-markup.md)

## Choosing what to render

Branch on a value, on a case, on whether something has landed, or on whether it failed —
the last two being why a template rarely needs a loading flag of its own.

Read on: [Conditionals](show-markup-conditionally.md)

## Keyed lists that move nodes

A keyed list reorders by moving nodes rather than rebuilding them, which is the
difference the benchmark cases here are chosen to show.

Read on: [Lists](repeat-markup-over-a-list.md)

## Events and two-way form binding

An event handler is an attribute, and a form binding is two-way without a handler in
between.

Read on: [Events](respond-to-a-click.md) · [Form binding](bind-a-form-to-state.md)

## Splitting markup into components

A component can live in the same file or its own. Its script decides what runs per
instance and what runs once, and its styles apply there and nowhere else.

Read on: [Components](reuse-a-piece-of-markup.md) ·
[Scripts](run-code-when-a-component-loads.md) ·
[Styles](scope-styles-to-a-component.md)
