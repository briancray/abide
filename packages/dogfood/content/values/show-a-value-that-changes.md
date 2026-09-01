---
title: Show a value that changes
nav: Local state
intent: Hold something the page can edit, and have the page follow it without being told to.
covers:
  - `state`
  - `s`
  - `s.set`
  - `Accepted`
  - `Stored`
  - `Transformer`
---

A counter is the smallest form of the problem every page has: something is held, something on
screen shows it, and the two have to stay in step. `state` is the holding. The staying in step
is not something you arrange.

```abide #ui/pages/counter/page.abide
<script>
import { state } from 'abide'

const count = state(0)
</script>

<button onclick={() => count += 1}>Clicked {count} times</button>
```

*1 declaration, 1 write* — no setter threaded through the markup, no re-render to schedule, and
no dependency to list.

## Declaring a state

`state(initial)` hands back a `Reactive` — the same one `memo`, `channel` and every rpc handler
hand back. So everything this section says about probes, `await` and `tail` is already true of
the counter above; nothing has to be wrapped in anything to have a face.

```abide abide
const name = state('')
const rows = state<Row[]>([])
const chosen = state<string | undefined>(undefined)
```

`state()` with no argument is a `Reactive<undefined>` that has **already landed**. An owned value
is not something that loads, so it reports `success()` from the moment it exists — which is what
keeps a page from having a value in a state none of `{#await}`'s branches would mount for.

## Reading and writing by name

Inside a `.abide` file the name is the value: `count` in an expression reads it, `count = 4`
writes it, `count += 1` does both. Naming it alone — a binding, a return, an argument typed as a
`Reactive` — hands over the value itself rather than reading it.

The sugar sits **over** two members, and both keep compiling everywhere:

```ts shared
count()        // the read — takes no arguments, ever
count.set(4)   // the write
```

A `.ts` file has no sugar, so that is what you write there. In a `.abide` file the explicit
spelling still compiles and still means exactly this — it is never a different mechanism.

Read on: [Values by name](../templates/read-and-write-a-value-by-name.md)

## What a write accepts, and what a read returns

`Accepted` is what goes in, `Stored` is what comes out. With no transform they are one type, so
`state<number>(0)` is one parameter as it reads.

`set` takes what `state` took — a settled value, or a load:

```abide abide
const user = state(fetchUser())
```

That is a `Reactive<User>`, never a `Reactive<Promise<User>>`. The state serves the **settled**
value, so `user = edited` writes a `User` rather than being made to wrap one. Hand it something
unsettled and the value is loaded: `pending()` is true, the document goes out with a hole where
the name was, and the hole fills when the row lands. One rule at construction and at every write
after it.

A state given a load has a producer, so `user.refresh()` reloads it and `ttl` reaches it. A state
you put a value into has neither, and the triggers are inert on it rather than destructive — they
never drop what an app put there.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[Reloading](decide-when-a-value-reloads.md)

## Normalising a value on the way in

A `Transformer` runs on the settled value before it is stored, which is where `Accepted` and
`Stored` come apart:

```abide abide
const slug = state('', { transform: (value) => value.trim().toLowerCase() })
```

It runs untracked, on the settled value — never on the promise and never per chunk — so a
transform sees whole values whatever the producer was.

A transform may also **refuse**: return a `Failed` and the write is rejected at the boundary
rather than stored and checked later. That is the validation path a `bind:` field goes through.

Read on: [Form binding](../templates/bind-a-form-to-state.md) ·
[Failures](../server/refuse-a-request-and-say-why.md)

## Next

* [Loading states](show-a-value-that-isnt-there-yet.md) — what a page shows before a value lands
* [Derived values](derive-a-value-from-other-values.md) — computing from what you already hold
* [Sharing](share-one-value-across-components.md) — one value read from two components
