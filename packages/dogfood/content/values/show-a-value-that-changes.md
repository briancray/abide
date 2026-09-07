---
title: Show a value that changes
nav: Local state
intent: Hold something the page can edit, and have the page follow it without being told to.
covers:
  - `state`
  - `s`
  - `s.set`
  - state › `Accepted`
  - `Stored`
  - `Transformer`
examples:
  - packages/dogfood/examples/local-state
---

Editing a profile is the whole of the problem every page has: something is held, something on
screen shows it, and the two have to stay in step. `state` is the holding. The staying in step
is not something you arrange.

{% example local-state %}

*2 values, 0 handlers* — no event listener, no setter threaded through the markup, no re-render
to schedule, and no dependency to list. Every feature named on this page is a feature of that
one example.

## `state(initial)` hands back a `Reactive`

`state(initial)` hands back a `Reactive` — the same one `memo`, `channel` and every rpc handler
hand back. So everything this section says about probes, `await` and `tail` is already true of
the profile above; nothing has to be wrapped in anything to have a face.

{% snippet local-state src/ui/pages/profile/page.abide const topics … const chosen %}

Whatever goes in — a literal, a type argument, nothing at all, or the load two sections
down — one type comes back.

`state()` with no argument is a `Reactive<undefined>` that has **already landed**. An owned value
is not something that loads, so it reports `success()` from the moment it exists — which is what
keeps a page from having a value in a state none of `{#await}`'s branches would mount for.

## The name is the value inside a `.abide` file

Inside a `.abide` file the name is the value: `handle` in an expression reads it, `handle = 'ada'`
writes it, and `bind:value={handle}` does both. Naming it alone — a binding, a return, an argument
typed as a `Reactive` — hands over the value itself rather than reading it.

{% snippet local-state src/ui/pages/profile/page.abide <h1> … <input bind:value %}

Neither line says `.get` or `.value`. The name in an expression is the read, and the
`bind:` is the read and the write at once.

The sugar sits **over** two members, and both keep compiling everywhere — which is what a
`.ts` file, having no sugar, has to write out:

{% snippet local-state src/shared/profile.ts export function save %}

That is the same read and the same write the two lines above are spelled over. In a
`.abide` file this explicit form still compiles and still means exactly this — it is never
a different mechanism.

Read on: [Values by name](../templates/read-and-write-a-value-by-name.md)

## `Accepted` goes in, `Stored` comes out

With no transform they are one type, so `state<number>(0)` is one parameter as it reads.

`set` takes what `state` took — a settled value, or a load:

{% snippet local-state src/shared/profile.ts export const profile %}

That is a `Reactive<User>`, never a `Reactive<Promise<User>>`. The state serves the **settled**
value, so `user = edited` writes a `User` rather than being made to wrap one. Hand it something
unsettled and the value is loaded: `pending()` is true, the document goes out with a hole where
the name was, and the hole fills when the row lands. One rule at construction and at every write
after it.

A state given a load has a producer, so `user.refresh()` reloads it and `ttl` reaches it. A state
you put a value into has neither, and the triggers are inert on it rather than destructive — they
never drop what an app put there. A `store` is the other way to give one a producer, and it is
what makes those same triggers mean something on a state you only ever wrote into.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[Reloading](decide-when-a-value-reloads.md) ·
[Persistence](keep-a-value-outside-the-process.md)

## A `transform` normalises a value on the way in

`transform` runs on the settled value before it is stored, which is where `Accepted` and
`Stored` come apart. Its type is `Transformer`:

{% snippet local-state src/shared/profile.ts export const handle %}

It runs untracked, on the settled value — never on the promise and never per chunk — so a
transform sees whole values whatever the producer was.

A transform may also **refuse**: return a `Failed` and the write is rejected at the boundary
rather than stored and checked later.

Both gates can refuse, and what you refuse **with** decides which one you reach for. A `schema`
refuses as `ValidationError` carrying the messages. A `transform` refuses as a name you declared
— `notAnEmail({ value })` — which is the only way a refusal arrives under its own name with its
own data. So an input check that wants a name is written here even though `schema` is nominally
the input gate.

Read on: [Form binding](../templates/bind-a-form-to-state.md) ·
[Failures](../server/refuse-a-request-and-say-why.md)

## Next

* [Loading states](show-a-value-that-isnt-there-yet.md) — what a page shows before a value lands
* [Derived values](derive-a-value-from-other-values.md) — computing from what you already hold
* [Sharing](share-one-value-across-components.md) — one value read from two components

