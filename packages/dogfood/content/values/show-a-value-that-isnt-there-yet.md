---
title: Show a value that isn't there yet
nav: Loading states
intent: Render before the data lands, and know the difference between empty, loading, reloading and failed.
covers:
  - `s.pending`
  - `s.refreshing`
  - `s.done`
  - `s.success`
  - `s.streaming`
  - `pending`
  - `refreshing`
  - `s.error`
  - `await s`
---

The usual shape of this is a loading flag, an error branch and a value, kept in step by hand —
three variables that can disagree, and usually do on the reload. Here the value carries all
three, and the ordinary page branches on none of them.

```abide #ui/pages/invoices/[id]/page.abide — excerpt
<script>
import { memo, route } from 'abide'
import { getInvoice } from '#server/rpc/invoices'

const invoice = memo(() => getInvoice({ id: route.params.id }))
</script>

<h1>Invoice {invoice.number}</h1>
```

*1 read, 0 loading branches* — against a loading flag, an error branch and a value kept in step
by hand.

That page has no loading branch in it. The read starts the load, the document goes out with a
hole where `invoice.number` was, and the hole fills when the row lands.

## A read never awaits

Reading is the whole subscription — there is no mount hook to put the load in and no `load()` to
call. What a read gives back depends only on where the value has got to:

| The value is | A read gives you |
| --- | --- |
| settled | the value |
| still in flight | `undefined`, and a sink opens where it was read |
| failed | it throws, to the nearest `{#try}` or to `error.abide` |

Member access on a `Reactive` short-circuits, so an in-flight `invoice.total` is `undefined`
rather than a TypeError, and the whole chain after it goes with it. That is what makes
`{data.name ?? 'Loading'}` and `{#for stat of data.stats ?? []}` read the same way — an `{#for}`
over `undefined` iterates zero times.

## Probes: `pending`, `refreshing`, `done`, `success`

A probe answers about the load without reading the value. **A probe never throws and never starts
work**, so it is safe in a branch that runs before anything has arrived.

| Probe | True when |
| --- | --- |
| `pending()` | a first load is in flight and there is nothing to show |
| `refreshing()` | a reload is in flight over a value still being served |
| `done()` | it finished, however it finished |
| `success()` | it landed, it did not fail, and nothing is still arriving |
| `streaming()` | it is currently producing chunks |
| `error()` | hands back the failure it ended with, if it failed |

`pending()` is what tells `undefined`-because-in-flight from a value that genuinely resolved to
`undefined`. And `done()` and `success()` **stay true through a `refresh()`** — the load that
finished still finished — so `refreshing()` is the only one that moves on a reload. A spinner
reads `refreshing()`; a table keeps rendering the rows it already has.

Reading a probe subscribes you to **that probe alone**. A value change does not wake a
`refreshing()` reader, and a `refreshing()` flip does not wake a value reader, which is why the
spinner and the table do not re-render each other.

```abide #ui/pages/invoices/[id]/page.abide — excerpt
{#if invoice.refreshing()}<span class="text-xs">Updating…</span>{/if}
<p>{invoice.total} due {invoice.dueOn}</p>
```

## Every `{#await}` branch is bound to a probe

`{#await}` is the spelled-out form of the same four questions, and each branch is bound to a
probe rather than to settledness:

```abide abide
{#await invoice}
    <p>Loading invoice…</p>
{:then row}
    <p>{row.total} due {row.dueOn}</p>
{:catch failure}
    <p class="error">Could not load that invoice.</p>
{:finally}
    <p class="text-xs">Last checked just now.</p>
{/await}
```

| Branch | Probe |
| --- | --- |
| the body | `pending()` |
| `{:then}` | `success()` |
| `{:catch}` | `error()` |
| `{:finally}` | `done()` |

Two consequences worth having in front of you. `{:finally}` renders **alongside** whichever of
the other two is mounted rather than replacing it, the way a `finally` runs after both. And
because `success()` survives a reload, `{:then}` stays mounted through a `refresh()` and its body
is **updated** when the new value lands rather than rebuilt — a destructured `{:then { total }}`
stays live for the same reason.

There is no state in which none of the branches is mounted. A value with no producer has landed
at construction, and a stream reports `pending()` until it **closes** rather than until its first
chunk — so nothing falls between them.

## Waiting on purpose

Not blocking is the default; holding is the opt-in, and there are two spellings of it.

```abide abide
<p>{await invoice.total} due</p>
```

`await` governs the whole **expression**, not the name — every reactive read inside it blocks —
and the reads are started before they are awaited, so `{await a.x + b.y}` is one round trip
rather than two loads serialized behind one hole.

The block form is the other one, and **the tell is whether there is a pending body**:

| Form | Holds |
| --- | --- |
| `{await invoice}` | yes |
| `{#await invoice then row}` | yes — there is no pending branch, so there is nothing to render instead |
| `{#await invoice}{:then row}` | no — the pending body is what renders while it loads |

So `then` on the opening tag is not shorthand for the same block. It is the deliberate wait, and
what it trades away is the branch that would have covered the wait:

```abide abide
{#await invoice then row}
    <p>{row.total} due {row.dueOn}</p>
{:catch failure}
    <p class="error">Could not load that invoice.</p>
{/await}
```

`{:catch}` and `{:finally}` still attach. The binding takes a name or a destructuring pattern —
`then { total }` — and stays live either way, so the body is **updated** when the value moves
rather than rebuilt.

Either spelling holds over a stream until the stream **closes**, the same way it holds until a
value settles. A source that never closes holds forever; that is the author's to resolve.

Read on: [Conditionals](../templates/show-markup-conditionally.md) ·
[Expressions](../templates/put-a-value-in-the-markup.md)

## Asking about everything in flight at once

The probes above are one value's. The free forms take a **selection** and answer over a set —
one memo, or every entry carrying a tag, or the whole scope when you pass nothing:

```abide #ui/pages/layout.abide — excerpt
<script>
import { pending, refreshing } from 'abide'
</script>

{#if pending() || refreshing()}<div class="progress-strip" role="status"></div>{/if}
```

Bare, that is anything in flight in this scope — which is what an app-wide progress strip wants.
Only these two probes have a free form: **any, not all** is the one question that aggregates
without a second rule, where `done()` and `success()` over a set are genuinely ambiguous between
the two and an aggregate `error()` would have to pick a failure to hand back.

A selection holds **one signal**, bumped when the count of matching in-flight entries crosses
zero. Ten entries reloading together wake that strip twice, not twenty times.

Read on: [Reloading](decide-when-a-value-reloads.md)

## A failed read throws; `error()` does not

A read of a failed value throws, which is how a failure reaches the nearest `{#try}` or
`error.abide` without every call site checking. `error()` hands the failure back instead, so a
page that wants to render a message rather than escalate has a way to decline:

```abide abide
{#if invoice.error()}
    <p class="error">Could not load that invoice.</p>
{:else}
    <p>{invoice.total}</p>
{/if}
```

`isError` narrows a caught failure by name, and `.data` is typed to what that failure declared.

Read on: [Failures](../server/refuse-a-request-and-say-why.md) ·
[Error pages](../pages/show-a-page-when-something-fails.md)

## Next

* [Reloading](decide-when-a-value-reloads.md) — `invalidate` against `refresh`, over one value or many
* [Streaming data](../server/send-data-as-it-arrives.md) — chunks, and what `streaming()` reads
* [Streaming HTML](../pages/send-the-page-before-the-data-lands.md) — how the hole reaches the browser
