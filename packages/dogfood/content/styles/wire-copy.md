---
title: Local state (wire copy)
nav: Wire copy
intent: The inverted pyramid again, in journalism voice — the A/B that separates structure from prose.
examples:
  - packages/dogfood/examples/local-state
---

> **Style — wire copy.** Inverted pyramid structure, journalism prose. This page holds the section
> order of [Inverted pyramid](inverted-pyramid.md) fixed and changes only the writing: one idea per
> sentence, active voice, a named actor, no em dashes, no second person, no evaluative aside, and
> every term defined at first mention. The pair isolates voice from structure.

A page can hold a value and follow it. `state()` creates that value. Any expression that reads the
value re-runs when something writes to it.

abide calls the object `state()` returns a `Reactive`. Inside a `.abide` file, the name of a
`Reactive` is the value. `handle` reads it. `handle = 'ada'` writes it.

The page registers no event listener. It threads no setter through its markup. It schedules no
re-render.

{% example local-state %}

*2 values, 0 handlers.*

## Reading and writing by name

Three spellings reach one value inside a `.abide` file. `handle` in an expression reads it.
`handle = 'ada'` writes it. `bind:value={handle}` does both.

Naming the value alone passes the `Reactive` itself. A binding, a return and an argument typed
`Reactive` are the three places that happens.

{% snippet local-state src/ui/pages/profile/page.abide <h1> … <input bind:value %}

Neither line names a method.

## The explicit spelling

A `Reactive` has two members for its value. `s()` returns what the value holds. `s.set(v)` writes
a new one.

A `.ts` file has no sugar over those members. It writes them out.

{% snippet local-state src/shared/profile.ts export function save %}

The compiler produces those same two members from the markup above. The sugar is a spelling and
not a second mechanism. Both forms compile inside a `.abide` file.

## The return type

`state()` returns a `Reactive`. So do `memo()`, `channel()` and every rpc handler.

A literal, a type argument, an omitted argument and a load all produce that one type.

{% snippet local-state src/ui/pages/profile/page.abide const topics … const chosen %}

The probes are the methods that report a value's condition. `pending()`, `success()` and `error()`
are three of them. They work on a value a page owns, and abide asks for no wrapper first.

## A state given a load

`state()` accepts a settled value or a promise. `set()` accepts either as well.

{% snippet local-state src/shared/profile.ts export const profile %}

The type above is `Reactive<User>`. It is not `Reactive<Promise<User>>`. A state serves the settled
value.

`pending()` returns true while the promise is in flight. The server sends the document with a hole
where the value belongs. The hole fills when the row arrives.

The rule holds at construction and at every write after it.

## Accepted and Stored

Two types describe a state. `Accepted` is what `state()` and `set()` take. `Stored` is what the
state holds and what a read returns.

The two are the same type when the state has no transform. `state<number>(0)` therefore takes the
single type parameter it appears to take.

## Transform

A transform is a function that shapes a value before the state stores it. Its type is
`Transformer`.

{% snippet local-state src/shared/profile.ts export const handle %}

A transform runs on the settled value. It runs untracked. It runs once for each value the state
stores, never on a promise and never on a single chunk.

A transform therefore sees whole values, whatever produced them.

## Refusing a write

A transform may reject a value. It returns a `Failed`, and the state stores nothing.

A schema may reject one too. A schema is a validator that runs before the transform.

The two differ in what they return. A schema returns `ValidationError` and carries the validation
issues. A transform returns a name the application declared, such as `notAnEmail({ value })`.

An application that needs to branch on a refusal writes that check as a transform.

## A state with no initial value

`state()` accepts no argument at all. The result is a `Reactive<undefined>`.

That state has already settled. `success()` returns true from the moment it exists.

An owned value does not load. No `{#await}` branch is left unmatched.

## Triggers and producers

A producer is a source that supplies a value without an application write. A promise is one. A
`store` is another.

`refresh()` and `invalidate()` reload a state that has a producer. `ttl` expires one.

A state that only ever received written values has no producer. The three triggers do nothing on
it. abide does not discard a value the application supplied.

## Next

* [Loading states](../values/show-a-value-that-isnt-there-yet.md) — what a page shows before a value lands
* [Derived values](../values/derive-a-value-from-other-values.md) — computing from what you already hold
* [Persistence](../values/keep-a-value-outside-the-process.md) — the other way to give a state a producer
