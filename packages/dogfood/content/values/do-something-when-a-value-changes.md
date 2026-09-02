---
title: Do something when a value changes
nav: Watching values
intent: Run a side effect on change — and clean it up when the value moves again.
covers:
  - `watch`
  - `s.watch`
  - `Effect`
  - `Disposer`
  - `watch` effect
  - `Transformer`, `Disposer`, middleware, lifecycle hooks
---

Most of what looks like an effect is a value. A title derived from a row, a filtered list, a
count — those are `memo`, and reaching for an effect to assign them is what builds a graph you
have to run in your head.

`watch` is for the rest: the things that happen **outside** the page. A timer, a subscription to
something that is not a `Reactive`, a write to `localStorage`, an analytics call.

```abide #ui/pages/editor/page.abide — excerpt
<script>
import { state, watch } from 'abide'

const draft = state('')

watch(() => {
    const id = setTimeout(() => save(draft), 1000)
    return () => clearTimeout(id)
})
</script>

<textarea bind:value={draft}></textarea>
```

*5 lines, cancel included* — the teardown is the return value rather than a second argument you
might forget.

## `watch` runs an effect on change

`watch(effect)` runs the effect immediately and again whenever anything it **read** changes — the
same tracking a memo body gets, and the same absence of a dependency list.

```ts browser
const stop = watch(() => { document.title = `${unread()} unread` })
```

It hands back the way to stop it. That matters where the watch has no owner: a watch registered
inside a component is owned by the component and torn down with it, but one registered from a
plain `.ts` module has nobody to tear it down, and the returned disposer is what you have.

`s.watch(effect)` is the same thing scoped to one value, handing the value to the effect:

```ts browser
const stop = unread.watch((count) => { document.title = `${count} unread` })
```

## `watch` hands back a disposer

An effect may return a `Disposer`, and abide runs it in two places:

| When | What runs |
| --- | --- |
| before each rerun | the previous run's disposer |
| once at teardown | the last run's disposer |

Teardown means what the watch was registered in: component unmount for a `<script>` watch, item
removal for one in a `{#for}` body, process end for a `<script module>` one.

That is why the timer above is correct without a guard. Every rerun cancels the timer the
previous run started, and the unmount cancels the last one.

## A `sources` list narrows what wakes an effect

The tracked form subscribes to everything the body read, which is usually what you want and
occasionally more than you want — a body that reads five values to build one log line wakes on
all five.

```ts browser
watch([user, plan], () => { analytics.identify(user(), plan()) })
```

With `sources` as the first argument it runs only when those change. It is two overloads rather
than a union, discriminated by that argument, so nothing has to be spelled to get the ordinary
form.

`peek()` is the same repair from the other side: `watch` narrows by whitelist, `peek` by
blacklist, and a memo has only the second, having no `sources` form.

Read on: [Reloading](decide-when-a-value-reloads.md)

## Tracking stops outside the render flow

A value is tracked only where it is part of the **render flow** — where something downstream will
be rebuilt from it. An event handler falls out of that rather than being excepted: it runs in
response to a person, after the output exists, so a subscription taken there has no consumer.

| Context | Tracks |
| --- | --- |
| template expression | yes |
| unkeyed `memo` body | yes |
| `watch` effect | yes, unless `sources` narrows it |
| component `<script>` setup | no — runs once, there is no rerun to feed |
| event handler, `bind:` write-back | no |
| `Transformer`, `Disposer`, middleware, lifecycle hooks | no |

The last row is one rule seen four ways. A transform normalises a value on the way in; a disposer
tears a run down; middleware and `onStart` / `onStop` / `onConfig` run around the app rather than
in it. None of them is a thing that gets rebuilt, so a read inside one takes no subscription — and
that is a guarantee rather than an accident, because a transform that subscribed would re-run on
a value it is in the middle of producing.

Read on: [Values by name](../templates/read-and-write-a-value-by-name.md) ·
[Lifecycle](../app/run-code-at-start-and-stop.md)

## A watch runs once on a server

There is no rerender, so a tracked read registers no subscriber and there is nothing to wake it
a second time. The disposer still runs at scope teardown.

That is isomorphism of intent rather than of schedule — same callable, same name, same meaning,
and what differs is that one side has a flow to feed and the other does not. It is worth saying
out loud because an effect written for its side effects reads as though it will run again.

## An effect that throws stops its watch

An error in an effect is never silent. A throwing effect, a throwing disposer, and a read of a
**failed** value inside one — which throws, as every read of a failure does — all reach `onError`
with the trace attached and warn on `abide:watch`. In a browser it is additionally re-thrown as
an unhandled rejection, so an error reporter sees it.

Then the watch stops. An effect that throws once usually throws every run, and a watch that
re-runs into the same throw is a loop with a log line per iteration. The warning names the watch,
and re-establishing it is the app's call if the failure was transient.

Read on: [Logging](../app/record-what-happened.md) ·
[Failures](../server/refuse-a-request-and-say-why.md)

## Next

* [Derived values](derive-a-value-from-other-values.md) — for the effects that are really values
* [Reloading](decide-when-a-value-reloads.md) — the reconnect watch, and `peek`
* [Scripts](../templates/run-code-when-a-component-loads.md) — where a component's setup runs
