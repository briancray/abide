---
title: Know when the browser goes offline
nav: Offline
intent: Show it, queue around it, and recover when the connection comes back.
covers:
  - `online`
---

A laptop sleeps. A train goes into a tunnel. Your page still has last minute's data on
screen and a form the reader is about to submit, and nothing on it says so.

You need two things: a way to tell them, and a way to catch up when the connection returns.

## The forms of `online`

| You write | What you get |
| --- | --- |
| `online` | a `Reactive<boolean>` — whether the caller can reach the app |
| `online()` | the same value, spelled explicitly |

There is one form and no options, `online` being ambient rather than declared: it is not
constructed, has no producer to reload and takes nothing to key on. What it is on each side is
[Ambient values](../reference/ambient-values.md).

## `online` is a reactive value

Read it by name, like any other.

```abide #ui/pages/orders/page.abide — excerpt
<script>
import { online } from 'abide'
</script>

{#if !online}
    <p role="status">You are offline. Nothing is being saved.</p>
{/if}
```

*1 name, 0 listeners* — against `online` and `offline` handlers, the teardown for both, and a
flag between them.

There is no listener to attach and no cleanup to remember. Reading it subscribes,
and the paragraph mounts and unmounts as the answer moves.

## `online` answers whether the caller can reach the app

One question, asked the same way on both sides and answered from what each side has.

| Side | Answered from |
| --- | --- |
| browser | `navigator.onLine` and its events |
| server | the request that arrived — a caller being served has reached the app |

So a document rendered for a client that dropped in the meantime says `true`, and the
client's own first read corrects it. That correction is an ordinary value change, not a
hydration mismatch: nothing is rebuilt, the text updates where it stands.

## Catch up by invalidating, not refreshing

When the connection comes back, what you want reloaded is whatever the reader is actually
looking at — not every value the scope is holding.

```abide #ui/pages/layout.abide — excerpt
<script>
import { online, refresh, watch } from 'abide'

watch(() => { if (online) refresh() })
</script>
```

`refresh()` is bounded by what is **subscribed** rather than by the scope: it reloads the
entries something is reading and degenerates to a mark for the rest. So a scope holding two
hundred catches up the handful a reader is holding and marks the other hundred and ninety-odd,
which is exactly the line above and makes it the reconnect default.

`invalidate()` is the other choice, for where nothing on screen may move: it drops the same
caches and leaves every value standing, so the catch-up happens on the next read. It is not a
cheaper `refresh()` to reach for first — an invalidated entry has nothing left to serve, so a
`refresh()` behind one drops every reader to its pending branch.

See [Reloading](../values/decide-when-a-value-reloads.md) for the two in full.

## `navigator.onLine` is a weak signal, and only in one direction

`false` is trustworthy: the interface is down, and nothing is going anywhere. `true` is a
guess — it says the interface is up, not that your server answers, so a captive portal, a
DNS failure and a dead backend all read as online.

That shapes what `online` is good for. It is right for telling a reader what to
expect and wrong as the gate on a write: the load that failed is the honest signal, and
`online` explains it. Read the failure, then read `online` to say why.

```abide #ui/pages/orders/page.abide — excerpt
{#if orders.error()}
    <p>{online ? 'Could not load orders.' : 'You are offline.'}</p>
{/if}
```

## Next

* [Loading states](../values/show-a-value-that-isnt-there-yet.md) — what a page shows before a value lands
* [Reloading](../values/decide-when-a-value-reloads.md) — `invalidate` against `refresh`, over one value or a selection
* [Watching values](../values/do-something-when-a-value-changes.md) — what `watch` runs, and when it stops
