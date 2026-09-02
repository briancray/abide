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

There is no listener to attach and no cleanup to remember. Reading it is what subscribes,
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
import { online, watch, invalidate } from 'abide'

watch(() => { if (online) invalidate() })
</script>
```

`invalidate()` marks the scope stale and loads nothing. The next read of each value fetches,
so a scope holding two hundred entries marks two hundred and loads the handful on screen.
`refresh()` would load all two hundred at the moment the network is least able to carry
them, which is why the lazy one is the reconnect default.

See [Reloading](../values/decide-when-a-value-reloads.md) for the two in full.

## `navigator.onLine` is a weak signal, and only in one direction

`false` is trustworthy: the interface is down, and nothing is going anywhere. `true` is a
guess — it says the interface is up, not that your server answers, so a captive portal, a
DNS failure and a dead backend all read as online.

That is the shape of what `online` is good for. It is right for telling a reader what to
expect and wrong as the gate on a write: the load that failed is the honest signal, and
`online` is what explains it. Read the failure, then read `online` to say why.

```abide #ui/pages/orders/page.abide — excerpt
{#if orders.error()}
    <p>{online ? 'Could not load orders.' : 'You are offline.'}</p>
{/if}
```

## Next

* [Loading states](../values/show-a-value-that-isnt-there-yet.md) — what a page shows before a value lands
* [Reloading](../values/decide-when-a-value-reloads.md) — `invalidate` against `refresh`, over one value or a selection
* [Watching values](../values/do-something-when-a-value-changes.md) — what `watch` runs, and when it stops
