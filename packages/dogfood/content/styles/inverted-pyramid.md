---
title: Local state (inverted pyramid)
nav: Inverted pyramid
intent: The local-state guide as newspaper wire copy — the whole story in the first sentence.
examples:
  - packages/dogfood/examples/local-state
---

> **Style — inverted pyramid.** News writing. The lede carries the entire story; every paragraph
> below it is ordered by descending importance and can be cut from the bottom without breaking
> what remains. Nothing refers backwards, because a reader may have entered anywhere.

`state(initial)` holds a value a page can edit, and inside a `.abide` file the name is the value:
`handle` in an expression reads it, `handle = 'ada'` writes it, and everything on screen that read
it follows the write. There is no listener to register, no setter to thread through the markup,
and no re-render to schedule.

{% example local-state %}

*2 values, 0 handlers.*

## The name is the value inside a `.abide` file

`handle` in an expression reads it. `handle = 'ada'` writes it. `bind:value={handle}` does both.
Naming it alone — as a binding, a return, or an argument typed as a `Reactive` — hands over the
value itself rather than reading it.

{% snippet local-state src/ui/pages/profile/page.abide <h1> … <input bind:value %}

Neither line says `.get` or `.value`.

## The explicit spelling still compiles, and a `.ts` file writes both members

The sugar sits **over** two members. A `.ts` file has no sugar, so it writes them out, and that
is the same read and the same write the markup above is spelled over — never a different
mechanism.

{% snippet local-state src/shared/profile.ts export function save %}

## `state(initial)` hands back a `Reactive`

The same `Reactive` that `memo`, `channel` and every rpc handler hand back. Whatever goes in — a
literal, a type argument, nothing at all, or a load — one type comes back, so probes, `await` and
`tail` are available on a value a page merely owns.

{% snippet local-state src/ui/pages/profile/page.abide const topics … const chosen %}

## A state given a load is pending until the value lands

`set` takes what `state` took: a settled value, or a load.

{% snippet local-state src/shared/profile.ts export const profile %}

That is a `Reactive<User>`, never a `Reactive<Promise<User>>`. The state serves the **settled**
value. Hand it something unsettled and `pending()` is true, the document goes out with a hole
where the name was, and the hole fills when the row lands. One rule at construction and at every
write after it.

## `Accepted` goes in, `Stored` comes out

With no transform the two are one type, so `state<number>(0)` is the one parameter it reads as.
They come apart only where something runs on the value between the write and the store.

## A `transform` normalises a value on the way in

`transform` runs on the settled value before it is stored. Its type is `Transformer`.

{% snippet local-state src/shared/profile.ts export const handle %}

It runs untracked, on the settled value — never on the promise and never per chunk — so a
transform sees whole values whatever the producer was.

## A `transform` may also refuse

Return a `Failed` and the write is rejected at the boundary rather than stored and checked later.
A `schema` refuses as `ValidationError` carrying the messages; a `transform` refuses as a name you
declared — `notAnEmail({ value })` — which is the only way a refusal arrives under its own name
with its own data. That is why an input check that wants a name is written as a transform even
though `schema` is nominally the input gate.

## `state()` with no argument has already landed

A `Reactive<undefined>` that reports `success()` from the moment it exists. An owned value is not
something that loads, which is what keeps a page from holding a value in a state none of
`{#await}`'s branches would mount for.

## A state you wrote into has no producer, so its triggers are inert

`refresh()` and `ttl` reach a state that was given a load, because there is something to fetch.
On a state you only ever put a value into they do nothing rather than dropping what an app put
there. A `store` is the other way to give one a producer.

## Next

* [Loading states](../values/show-a-value-that-isnt-there-yet.md) — what a page shows before a value lands
* [Derived values](../values/derive-a-value-from-other-values.md) — computing from what you already hold
* [Persistence](../values/keep-a-value-outside-the-process.md) — the other way to give a state a producer
