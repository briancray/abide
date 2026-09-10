---
title: Read and write a value by name
nav: Values by name
intent: What `count` means in a template, and the explicit spelling it is sugar over.
covers:
  - `foo` in an operand, text, attribute or value-typed argument
  - `const x = foo` / `return foo` / a `Reactive<…>`-typed argument
  - `foo = bar` where `bar` is a `Reactive`
  - `foo = bar`
  - `foo.bar = v`
  - `foo.push(v)`
  - `foo.bar`
  - `foo.bar(…)`
  - `foo()` / `foo.set(v)`
examples:
  - packages/dogfood/examples/name-path-write
---

Inside a `.abide` file a name bound to a `Reactive` **is** the value. `count` in an expression
reads it, `count = 3` writes it, and neither spelling has a call in it. Nothing is generated
that you could not have written yourself: the sugar sits over `count()` and `count.set(3)`, and
both of those keep compiling in the same file.

## What a name means, by position

| You write | You get |
| --- | --- |
| `foo` in an operand, text, attribute or value-typed argument | a live read |
| `const x = foo` / `return foo` / a `Reactive<…>`-typed argument | the `Reactive` itself |
| `foo = bar` | a write, of a settled value or a load |
| `foo.bar` | the value's `bar`, or `undefined` before it lands |
| `foo.bar(…)` | the `Reactive` API where `bar` is one of its members |
| `foo()` / `foo.set(v)` | the two explicit forms |

The rule is **position**, not decoration. An operand is a place a value belongs, so the name
reads; a binding, a return and a `Reactive`-typed parameter are places the `Reactive` belongs,
so the name holds. That split is why a value can be passed to a component without being read
first, and why reading one never needs a sigil to mark it.

A `.ts` file has no sugar and writes the members out. The same explicit form inside a `.abide`
file means exactly this, so moving code between the two changes what you type and never what
it does.

## Reading is live, holding is not

`{total}` re-reads whenever `total` produces. `const held = total` does not read at all — it
takes the `Reactive`, which is what a prop typed as one wants, and what `bind:` needs on both
sides of the arrow.

Assigning a `Reactive` to a name that already holds one is a **compile error naming both
repairs**: write `foo = bar()` to move the value, or pass `bar` where the `Reactive` is wanted.
The two are different intentions and neither is what `foo = bar` looks like.

Read on: [Local state](../values/show-a-value-that-changes.md) ·
[Components](reuse-a-piece-of-markup.md)

## A write through a member path copies down that path

{% example name-path-write %}

*1 line, 2 copies* — and the arm has to make both by hand, one per segment of the path.

`contact.address.city = 'Oslo'` copies `contact`, copies `contact.address`, sets `city`, and
writes the new outer object back. The copy is **not optimised away**, even where nothing appears
to be holding the old one. What holds it is the identity check every reader downstream is made
of, and a value written in place is the object it already was — so nothing has a reason to
re-read it.

`contact.tags.push('vip')` is the same write reached through a mutator. Which mutators do it is
resolved from the **type** of the `Reactive` rather than from the method name, so a `push` on
your own object with a `push` of its own is your method and not a write.

Read on: [Patching a list](../values/patch-a-list-from-a-live-feed.md)

## A property access short-circuits before the value lands

`{contact.address.city}` on a value still loading renders nothing rather than throwing, and the
**rest of the chain short-circuits with it** — there is no depth at which a half-landed read
becomes an error. That is what lets a template name a field of a record it is still waiting for
without a guard around every mention of it.

A call on the name reaches the `Reactive` API where the name is one of its members —
`contact.pending()`, `contact.error()` — and the value's own method otherwise. The members are
few and documented, so the collision is a question you can answer by looking rather than by
running.

A read spelled `foo()` takes no arguments, and passing one is a compile error. `foo` is not a
function you call; `foo()` is the explicit spelling of a read, and an argument in it is
somebody meaning something else.

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md) ·
[Reactive](../reference/reactive.md)

## Next

* [Expressions](put-a-value-in-the-markup.md) — where a read can go in the markup
* [Form binding](bind-a-form-to-state.md) — the binding that reads and writes in one place
* [Local state](../values/show-a-value-that-changes.md) — what `state` hands back to name
