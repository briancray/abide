---
title: Selections
nav: Selections
intent: The four free functions that ask about many entries at once.
enumerates:
  - Selections — over many entries
---

A probe answers about one [`Reactive`](reactive.md); a **selection** answers about a set of
them. The four below are free functions, and the members on a value are defined as them —
`s.refresh()` is `refresh(s)`, and `m.refresh(pattern)` is `refresh(m)` narrowed by args.

## Syntax

```ts browser
pending(selection)
refreshing(selection)
refresh(selection)
invalidate(selection)
```

Called bare, each one means the whole scope.

## Members

| Name | Signature | Description |
| --- | --- | --- |
| `Selection` | `Reactive<any, any, any, any> \| Memo<any, any, any, any> \| { tags: string[] }` | One value, one keyed memo — every args key of it — or every entry carrying any of these tags, across memos. |
| `pending` | `(selection?: Selection) => boolean` | Whether any entry in the selection is loading for the first time. |
| `refreshing` | `(selection?: Selection) => boolean` | Whether any entry is reloading over a value still being served. |
| `refresh` | `(selection?: Selection) => void` | Stale while revalidate, over the selection. |
| `invalidate` | `(selection?: Selection) => void` | Marks the selection stale. Nothing loads until the next read. |

## Description

**Any, not all.** "Is anything loading" is the only question that aggregates without a second
rule, which is why only these two probes have a free form. `done()` and `success()` over a set
are ambiguous between any and all, and an aggregate `error()` would have to decide which failure
to hand back.

One signal is held per selection, never one per entry, so a page-level spinner over n entries
reloading together wakes twice rather than 2n times.

**Naming reaches anything; sweeping reaches producers.** A value named by hand is the app
saying so about that one value, but a bare `invalidate()` matches only entries that have a
producer — catching a `state(0)` would be silent data loss.

`invalidate` is lazy and `refresh` is eager, and at this width the eager one is bounded by what
is subscribed. An `invalidate()` over two hundred entries drops two hundred caches and loads
none, where a `refresh()` reloads only what something is reading and marks the rest. That is
what makes `refresh()` the reconnect default.

A selection is scope-bounded as a memo is, and a tag with it, so one request can never
invalidate another's. The `global` entries are the exception on a server: a bare `invalidate()`
and a bare `refresh()` each reach every one of them in the process, that being the whole of what
a bare sweep can still touch once the request's own entries die with it.

## Examples

### A page-level activity indicator

```abide abide
{#if pending() || refreshing()}<Spinner/>{/if}
```

### Everything about one row, across memos

```ts server
invalidate({ tags: [`customer:${id}`] })
```

### Catching up after a reconnect

```ts browser
watch(() => {
    if (online) refresh()
})
```

## See also

* [Reloading](../values/decide-when-a-value-reloads.md)
* [Caching](../values/load-once-per-set-of-arguments.md)
* [`memo`](memo.md) · [`Reactive`](reactive.md)
