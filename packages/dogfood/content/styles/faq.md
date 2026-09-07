---
title: Local state FAQ
nav: FAQ
intent: The local-state guide as a question list — every heading a question somebody actually asked.
examples:
  - packages/dogfood/examples/local-state
---

> **Style — FAQ.** Support-desk shape. Every heading is a question in the reader's own words, the
> answers are independent and unordered, and the list grows by accretion rather than by design.
> What nobody asks about does not appear, however important it is.

Questions that come up about values a page owns.

{% example local-state %}

## What does `state()` return?

A `Reactive` — the same type `memo`, `channel` and every rpc handler return. So anything the docs
say about probes, `await` or `tail` is already true of a value you just declared on a page.

## Do I have to write `.get()` or `.value` to read a state?

Not in a `.abide` file. The name is the value there:

{% snippet local-state src/ui/pages/profile/page.abide <h1> … <input bind:value %}

`handle` in an expression reads it, `handle = 'ada'` writes it, and `bind:value={handle}` does
both.

## Do `s()` and `s.set()` still work?

Yes, everywhere, including inside a `.abide` file. The sugar sits **over** those two members and
never instead of them. A `.ts` file has no sugar, so it writes them out:

{% snippet local-state src/shared/profile.ts export function save %}

That is the same read and the same write the markup above is spelled over.

## What happens if I just name a state without using it?

You hand over the value itself rather than reading it. That is how a state is passed to a
component, returned from a function, or accepted as an argument typed `Reactive`.

The difference is worth being precise about, because both spellings are one word: naming it *in an
expression* is a read; naming it *alone* is the value.

## Why does the page update when nothing subscribed to anything?

Because the expression that rendered the value is the subscription. Reading a state inside a
template registers the read, so the write knows who to wake. There is no listener to add and no
re-render to schedule.

## What is the difference between `Accepted` and `Stored`?

`Accepted` is what goes in — what `state()` and `set()` take. `Stored` is what is kept, and what a
read gives back.

Without a `transform` they are the same type, which is why `state<number>(0)` reads as one type
parameter. A `transform` is what moves them apart. A `schema` does not, because it returns what it
stores.

## When does a `transform` run?

On the settled value, before it is stored, once per stored value — per write on a state, never on
the promise, and never per chunk.

{% snippet local-state src/shared/profile.ts export const handle %}

So it always sees whole values, whatever produced them.

## Can a `transform` reject a value?

Yes. Return a `Failed` and the write is refused at the boundary rather than stored and checked
later.

## Should I validate with `transform` or with `schema`?

Both gates refuse; the difference is what they refuse *with*.

A `schema` refuses as `ValidationError` carrying the validation issues. A `transform` refuses under
a name you declared — `notAnEmail({ value })` — with data of your own attached, and that is the
only way to get one. So if the refusal needs a name your code can branch on, write it as a
transform even though `schema` is nominally the input gate.

## Can I pass a promise to `state()`?

Yes, and it is the normal way to fill a state from the server:

{% snippet local-state src/shared/profile.ts export const profile %}

That is a `Reactive<User>`, never a `Reactive<Promise<User>>`. `pending()` is true while it is in
flight, the document goes out with a hole where the value was, and the hole fills when the row
lands. `set` follows the same rule, so a write can be a load too.

## Does `refresh()` work on a state?

Only on one that has a producer — a state given a load, or given a `store`. On a state you only
ever wrote a value into there is nothing to fetch, so `refresh()` and `ttl` do nothing rather than
discarding what you put there.

## What does `state()` with no argument give me?

A `Reactive<undefined>` that has **already landed** — `success()` is true from the moment it
exists. An owned value is not something that loads, so a page never has to handle a value sitting
in a condition no `{#await}` branch would mount for.

## Where should a state live?

In the page if only that page reads it; in `#shared` if a handler, a test or a second page needs
the same one. There is no provider and no context to thread — a module-level state is reachable by
importing it.

## See also

* [Local state](../values/show-a-value-that-changes.md)
* [Loading states](../values/show-a-value-that-isnt-there-yet.md)
* [Sharing](../values/share-one-value-across-components.md)
