---
title: Slow down a value that changes too fast
nav: Throttle & debounce
intent: A search box that fires on every keystroke, without firing on every keystroke.
covers:
  - `throttle`
  - `debounce`
  - `identity`
---

A search box is the case where "reading is what loads it" stops being free. Bind the input to a
state, derive the results from it, and you have declared one request per keystroke.

```abide #ui/pages/search/page.abide
<script>
import { state, memo } from 'abide'
import { search } from '#server/rpc/search'

const query = state('')
const results = memo(() => search({ q: query }), { debounce: 200 })
</script>

<input bind:value={query} placeholder="Search">
{#if results.refreshing()}<span class="text-xs">Searching…</span>{/if}
<ul>{#for row of results ?? []}<li>{row.title}</li>{/for}</ul>
```

*1 option, 0 markup changed* — it goes on the memo that pays the cost, and the probes did not
move either.

## `throttle` against `debounce`

Both cap **revalidation**, and both apply however it was triggered — a dependency moving, an
explicit `invalidate`, a `refresh`, a `ttl` lapsing. There is no second rule for the manual case.

| | Fires |
| --- | --- |
| `throttle: n` | immediately, then at most once per `n` ms |
| `debounce: n` | once the triggers stop for `n` ms |

Set both and `debounce` wins.

`throttle` is right where the value is being watched — a live count, a cursor position, anything
where the first update should be immediate and the rate is the problem. `debounce` is right where
the intermediate values are not answers — a half-typed query being the example the whole page is
built on.

## What a capped memo reports while it waits

Nothing new. Inside the window the held value keeps being served and `refreshing()` is true,
which is the `refresh()` contract already:

```abide abide
{#if results.refreshing()}<span class="text-xs">Searching…</span>{/if}
```

So a list does not blank between keystrokes, and there is no fourth probe to learn. A **first**
load still reports `pending()`, there being nothing held to serve.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[Reloading](decide-when-a-value-reloads.md)

## Where the cap belongs

On the memo, not at the call site. A memo that must not join a stampede says so about itself,
where the knowledge is — a tag-wide `invalidate({ tags: ['invoice'] })` cannot know what else it
matched, so it is the wrong place to decide how hard any one entry may be hit.

Read on: [Caching](load-once-per-set-of-arguments.md)

## Waking readers only when the value moved

The other half of "too fast" is a value that changes without changing. `identity` is what makes
it the same value — **readers wake when this moves, not when the reference does**:

```ts #server/rpc/rows.ts
const summary = memo(({ id }: { id: string }) => rollUp(id), { identity: canonical })
```

The default is `(value) => value`, which is the reference. `canonical` is exported for the common
opt-in — an args object, a derived record, a URL — and is the same builder a memo key uses.

This is the failure that leaves the output right and the work wrong. A body that rebuilds its
result every run defeats the identity check, so `oldValue !== value` is always true and every
propagation cutoff downstream of it silently stops working. Nothing renders incorrectly; the page
just re-renders on every recompute. It is the same shape as a memo whose value is a **component**,
where a rebuilt identity re-mounts the whole subtree and throws away the DOM.

## What `identity` costs

Canonicalising is O(size) per recompute, which is why it is not the default for objects. A
five-thousand-row result would be serialised on every run to decide whether to wake anyone — a
cost paid per write to buy a cheaper read, and worth it only where the reads outnumber the writes
and the rebuild is real.

It runs on the **settled** value, never per chunk. On a streaming producer that means the
accumulation.

## Next

* [Caching](load-once-per-set-of-arguments.md) — the entries a cap applies to
* [History & tail](keep-the-last-few-values.md) — the other way an accumulating value gets expensive
* [Form binding](../templates/bind-a-form-to-state.md) — the input the query came from
