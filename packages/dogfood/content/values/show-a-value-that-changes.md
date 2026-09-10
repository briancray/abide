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
  - packages/dogfood/examples/state-owned
  - packages/dogfood/examples/state-loaded
  - packages/dogfood/examples/state-transform
---

Editing a profile is the whole of the problem every page has: something is held, something on
screen shows it, and the two have to stay in step. `state` is the holding. You do not arrange the
staying in step.

## The forms of `state`

| You write | What you get |
| --- | --- |
| `state(v)` | a value the page owns, landed from the moment it exists |
| `state(load)` | the same, serving the **settled** value once it arrives |
| `state(v, options)` | either, with a gate or a shape on the way in |

The options are `schema`, `transform`, `store`, `identity`, `tail` and `ttl`, and what comes back
is a `Reactive` — the same one `memo`, `channel` and every rpc handler hand back, so a member
learned here is a member everywhere. Every signature is in the
[`state` reference](../reference/state.md).

## A state is read and written by its own name

{% example state-owned %}

*2 lines, 0 listeners* — against the handler the hand-written arm needs for each place the value
is shown.

Inside a `.abide` file the name **is** the value: `handle` in an expression reads it, `handle =
'ada'` writes it, and `bind:value={handle}` does both. Naming it alone — a binding, a return, an
argument typed as a `Reactive` — hands over the value itself rather than reading it.

The sugar sits **over** two members, `s` and `s.set`, and both keep compiling everywhere. A `.ts`
file has no sugar, so it writes them out, and that explicit form still means exactly this inside a
`.abide` file. It is never a different mechanism.

Read on: [Values by name](../templates/read-and-write-a-value-by-name.md)

## A load given to a state serves the settled value

{% example state-loaded %}

That is a `Reactive<Contact>`, never a `Reactive<Promise<Contact>>`. The state serves the
**settled** value, so a write puts a `Contact` in rather than being made to wrap one, and the read
is `contact.name` at every site rather than an await. One rule at construction and at every write
after it: `s.set` takes what `state` took, a settled value or a load.

`state()` with no argument is a `Reactive<undefined>` that has **already landed**, and reports
`success()` from the moment it exists — which keeps a page from holding a value in a state none of
`{#await}`'s branches would mount for.

A state given a load has a producer, so `refresh` reloads it and `ttl` reaches it. A state you put
a value into has neither, and the triggers are inert on it rather than destructive — they never
drop what an app put there. A `store` is the other way to give one a producer.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[Reloading](decide-when-a-value-reloads.md) ·
[Persistence](keep-a-value-outside-the-process.md)

## A `transform` shapes a value on the way in

{% example state-transform %}

`Accepted` is what you typed and `Stored` is what the transform returned, and with no transform
they are one type — which is why `state<number>(0)` is one parameter as it reads. The field shows
the stored form back because a binding holds the value rather than a copy of it.

It runs untracked, on the settled value — never on the promise and never per chunk — so a
transform sees whole values whatever the producer was. Its type is `Transformer`.

A transform may also **refuse**, and what you refuse with decides which gate you reach for. A
`schema` refuses as a `ValidationError` carrying the messages; a `transform` refuses as a name you
declared, which is the only way a refusal arrives under its own name with its own data.

Read on: [Form binding](../templates/bind-a-form-to-state.md) ·
[Schemas](../server/check-what-callers-send-you.md) ·
[Failures](../server/refuse-a-request-and-say-why.md)

## Next

* [Loading states](show-a-value-that-isnt-there-yet.md) — what a page shows before a value lands
* [Derived values](derive-a-value-from-other-values.md) — computing from what you already hold
* [Sharing](share-one-value-across-components.md) — one value read from two components
