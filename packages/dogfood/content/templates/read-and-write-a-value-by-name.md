---
title: Read and write a value by name
nav: Values by name
intent: What `count` means in a template, and the explicit spelling it is sugar over.
covers:
  - `foo` wherever the declared type of its position is not a `Reactive`
  - `const x: Reactive<…> = foo` / a `Reactive<…>`-typed parameter, return or `bind:` operand
  - `const [a, b] = foo` / `...foo`
  - `foo = bar`
  - `foo.bar = v`
  - `foo.push(v)`
  - `foo.bar`
  - `foo.bar(…)`
  - `foo()` / `foo.set(v)`
  - `await foo`
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
| `foo` anywhere its position is not typed as a `Reactive` | a live read |
| `const x: Reactive<…> = foo` / a `Reactive<…>`-typed parameter or `bind:` | the `Reactive` itself |
| `foo = bar` | a write, of a settled value, a load or a `Reactive` to adopt |
| `foo.bar` | the value's `bar` |
| `foo.bar` / `foo.bar(…)` where `bar` is one of its members | the `Reactive` API |
| `foo()` / `foo.set(v)` | the two explicit forms |
| `await foo` | the value, once it has settled |

The rule is **position**, not decoration. An operand is a place a value belongs, so the name
reads; a position whose declared type is a `Reactive` — an annotated binding, a parameter, a
`bind:` operand — is a place the `Reactive` belongs, so the name holds. That split is why a value can be passed to a component without being read
first, and why reading one never needs a sigil to mark it.

A `.ts` file has no sugar and writes the members out. The same explicit form inside a `.abide`
file means exactly this, so moving code between the two changes what you type and never what
it does.

## Reading is live, holding is not

`{total}` re-reads whenever `total` produces. `const held = total` reads too, like any other
position with no type to say otherwise. **Holding is declared in the type**:
`const held: Reactive<number> = total` takes the `Reactive`, which is what a prop typed as one
wants, and what `bind:` needs on both sides of the arrow. Destructuring and spreading read once:
`const [first, second] = rows` takes two rows, not two pieces of a `Reactive`.

A name on the right of `=` is read like any operand. A `Reactive` that arrives any other way is
**adopted**: `paid = payInvoice({ id })` makes `paid` serve what the call serves, and go on
following it as it produces — the same thing a body returning a `Reactive` does. From then on a
settled value written to `paid` goes through to what it adopted (11.60), and only another
`Reactive` re-points it (11.62).

`await foo` is the one other position that holds. Every `Reactive` is a promise for its own
settling, so `await invoice` waits for the value and hands it to you — the same line you would
write in a `.ts` file, meaning the same thing. Lowered as a read it would be `await invoice()`,
which takes what has landed and throws where nothing has, and that is never what an `await` was
asking for.

**Where you can write one** is anywhere there is a function to write it in: a handler, a `reactive`
body, an `async` arrow of your own. Not at the top of a `<script>`, and not in a template position.
Setup is a function body and a slot is compiled into one, so neither has anything to await in, and
both are compile errors rather than a module that will not parse. Nothing in abide holds a render,
so there is no position where waiting would mean the page waits.

Read on: [Local state](../values/show-a-value-that-changes.md) ·
[Loading states](../values/show-a-value-that-isnt-there-yet.md) ·
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

## A property access is a read

`{contact.address.city}` is exactly `contact().address.city`. On a value still loading it throws
`NotLanded` like any read, so the hole **renders nothing until the value lands** and then fills
— and where it has rendered before, it keeps what it showed rather than blanking. A fallback for
the wait belongs to the probe, not to `??`: `{contact.ready() ? contact.name : '—'}`. The
compiler warns on a `??` whose left side could only be missing because nothing has landed yet.

A member of the `Reactive` itself reaches the `Reactive` rather than the value —
`contact.busy()`, `contact.error()`, and `onclick={person.refresh}` without the call, which
hands over `refresh` bound to `person`. Anything else is the value's own. Where the value
declares a member by the same name the compiler warns, and `contact().error` is how to reach
the value's.

A read spelled `foo()` takes no arguments, and passing one is a compile error. `foo` is not a
function you call; `foo()` is the explicit spelling of a read, and an argument in it is
somebody meaning something else.

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md) ·
[`reactive`](../reference/reactive.md)

## Next

* [Expressions](put-a-value-in-the-markup.md) — where a read can go in the markup
* [Form binding](bind-a-form-to-state.md) — the binding that reads and writes in one place
* [Local state](../values/show-a-value-that-changes.md) — what `reactive` hands back to name
