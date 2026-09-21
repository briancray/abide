---
title: What abide is for
nav: Why abide
intent: One type for everything that changes, instead of three that disagree.
covers:
  - `Reactive`
examples:
  - packages/dogfood/examples/one-type
---

An interface is mostly waiting. Something is loading, reloading, streaming, stale, or failed.
Every framework agrees this is the hard part, then hands you three tools for it:

* component state, for what you own
* a query library, for what you fetch
* a socket client, for what gets pushed to you

Three shapes, three loading conventions, three spellings of "it broke" — for one question the
user is asking: **is it here yet?**

abide has one answer.

## Everything is a reactive value

{% example one-type %}

*4 declarations, 1 type* — against component state, a query library and a socket client, each
with its own loading convention, which is what the hand-written arm has to keep.

Four ways of getting a value, one type back — every one of them is `reactive`: a value the
scope owns, a value with a body, a body that loads, and a value that waits for a publish. Declare
`history` on that last kind and it is a channel, state the system keeps sending to everyone
connected — still a `Reactive` like the other three, carried over a socket or not. See
[Sockets](../server/keep-a-room-of-callers-in-sync.md).

That is not a naming convenience:

* the branch you write for "loading" works on all four
* a component taking a `Reactive<User>` does not care where the user came from
* swapping a local value for a remote one changes how it is declared and nothing downstream

## Reading starts the work

No `useEffect`. No `load()`. No mount hook to put the fetch in.

A value with a body runs it as soon as you reach it, and runs it again on the next read after
something the body read changes. The page reads it because you put it in the markup. That is the whole subscription.

The consequence worth internalising:

> [!TIP]
> A read of a value that has not arrived throws `NotLanded`, and the output keeps a hole where it
> was. It does not block. The document goes out; the hole fills when the value lands.

Nothing waits for it. The document goes out, the hole fills, and `{#if invoice.ready()}` is the
branch to show in the meantime — so a slow value is a page that is late rather than a page that
is not there.

## Same name, both sides

| | server | browser |
| --- | --- | --- |
| `getInvoice({ id })` | calls the function | fetches the endpoint |
| `route.url` | the URL requested | the URL in the address bar |
| `cookies()` | the request's cookies | the document's cookies |
| `log.info(…)` | stdout | console, and the app's log feed |

Where a name genuinely cannot mean anything — a page reading the incoming request during a
static build — it throws and names the component and the accessor. It does not quietly return
nothing.

## The handler serving your page already describes itself

Address, method, argument and result schemas, description — all of it already written down. An
agent calling your app calls what your app already does.

That is why failures are strict. A refusal is a **named value carrying data**, not a status
code and a sentence:

```ts #server/rpc/groups.ts
return notMember({ group: 'staff' })
```

The caller narrows it by name and gets `.data` typed — your own template and a model on the
far side of an HTTP request, identically.

## Who abide is not for

| | why |
| --- | --- |
| A static marketing site | It renders one fine, but nothing here earns its keep if nothing changes |
| Gradual adoption into an existing app | The `#ui` / `#server` / `#shared` seams are the mechanism, not a convention. No partial mode |
| Swapping the runtime | abide is Bun and web standards, deliberately, and uses Bun's APIs rather than abstracting them |

## Next

* [First page](your-first-page.md) — write one and run it
* [Loading states](../values/show-a-value-that-isnt-there-yet.md) — the branch you write most
