---
title: Run code when a component loads
nav: Scripts
intent: Setup that runs per instance, setup that runs once, and setup that runs inside a branch.
covers:
  - `<script>`
  - `<script module>`
examples:
  - packages/dogfood/examples/script-scope
---

A `.abide` file's `<script>` block is the component's setup. It runs when an instance is
created, in order, top to bottom — there is no mount hook to register and nothing to call it
from, because the block **is** the hook.

## The two blocks

| You write | Runs |
| --- | --- |
| `<script>` | once per instance of the component |
| `<script module>` | once for the module — request-local on a server, process-wide in a browser |

The difference is what a variable declared in each belongs to. One row's `calls` is that row's;
a lookup table every row shares belongs to the module and is built once however many rows there
are.

`<script module>` being **request-local on a server** is the half worth stating out loud: a
module-scope variable on a server is not shared between two callers, which is what would make
it a place one request's data leaks into another's.

## Per instance, and once

{% example script-scope %}

*2 blocks, 0 conventions* — the arm's module scope is whatever happens to sit outside the
factory, which is where a shared variable ends up by accident rather than by decision.

`props()` is callable from a `<script>` block only. A `<script module>` block has no instance
to read props of, so calling it there is a compile error rather than an undefined at runtime.

## A setup body does not track

Whatever a `<script>` body reads while it runs subscribes to nothing. A call written bare in
one registers nothing and never follows its arguments, which is why a load that has to follow
something is wrapped in a `memo` — that wrapper is compulsory rather than a matter of taste.

The same is true of a **branch-local** `<script>` in a block body: it is setup for that item,
run once per item, and it tracks nothing either.

Read on: [Derived values](../values/derive-a-value-from-other-values.md) ·
[Watching values](../values/do-something-when-a-value-changes.md)

## A stylesheet a script imports is a dependency of the component

`import './app.css'` from any `<script>` in the file — or from any `.ts` it reaches — makes
that stylesheet a dependency of that component, so it ships where the component ships and not
otherwise.

Read on: [Styles](scope-styles-to-a-component.md)

## Next

* [Components](reuse-a-piece-of-markup.md) — what a `<script>` reads its props from
* [Watching values](../values/do-something-when-a-value-changes.md) — code that runs again when a value moves
* [Styles](scope-styles-to-a-component.md) — the third block a `.abide` file has
