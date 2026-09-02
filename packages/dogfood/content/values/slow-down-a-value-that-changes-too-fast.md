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

## `throttle` fires first and rate-limits; `debounce` waits for quiet

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

## A capped memo keeps serving the held value

Inside the window the held value keeps being served and `refreshing()` is true, which is the
`refresh()` contract already:

```abide abide
{#if results.refreshing()}<span class="text-xs">Searching…</span>{/if}
```

So a list does not blank between keystrokes, and there is no fourth probe to learn. A **first**
load still reports `pending()`, there being nothing held to serve.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[Reloading](decide-when-a-value-reloads.md)

## The cap belongs on the memo, not at the call site

A memo that must not join a stampede says so about itself, where the knowledge is — a tag-wide
`invalidate({ tags: ['invoice'] })` cannot know what else it matched, so it is the wrong place to
decide how hard any one entry may be hit.

Read on: [Caching](load-once-per-set-of-arguments.md)

## `identity` wakes readers only when the value moved

The other half of "too fast" is a value that changes without changing. `identity` is what makes
it the same value — **readers wake when this moves, not when the reference does**:

```ts #server/rpc/rows.ts
const summary = memo(({ id }: { id: string }) => rollUp(id), {
    identity: canonical,
})
```

The default is `(value) => value`, which is the reference. `canonical` is exported for the common
opt-in — an args object, a derived record, a URL — and is the same builder a memo key uses.

It is an option on every `Reactive`, not something a memo has. A state holding an object is the
case you hit first: a form binding rewrites it per keystroke, a `refresh()` on `state(fetchUser())`
returns a structurally identical user, and a write through a member path copies down the path —
each of them a new reference for a value that did not move.

```ts #ui/state/filters.ts
const filters = state({ status: 'open', assignee: null }, {
    identity: canonical,
})
```

On a room it reads as **consecutive duplicates collapse** — a presence channel republishing an
unchanged roster every five seconds wakes nobody, and `publish` hands back the standing `seq`. The
default being the reference, a room collapses nothing until it asks for it: two separately built
messages are never reference-equal, so a double-sent chat line is still two messages.

This is the failure that leaves the output right and the work wrong. A body that rebuilds its
result every run defeats the identity check, so `oldValue !== value` is always true and every
propagation cutoff downstream of it silently stops working. Nothing renders incorrectly; the page
just re-renders on every recompute. It is the same shape as a memo whose value is a **component**,
where a rebuilt identity re-mounts the whole subtree and throws away the DOM.

## `identity` costs O(size) per production

Canonicalising is O(size) per production — per `set`, per recompute, per publish — which is why it
is not the default for objects. A five-thousand-row result would be serialised on every run to
decide whether to wake anyone: a cost paid per write to buy a cheaper read, and worth it only where
the reads outnumber the writes and the rebuild is real.

It compares the **stored** value against the previous one, which is why it never runs per chunk —
a streaming producer has one stored value, materialised when it closes. It holds one token and not
a set, so uniqueness is against the previous stored value rather than against the tail, and raising
`tail` never makes a write dearer.

## Next

* [Caching](load-once-per-set-of-arguments.md) — the entries a cap applies to
* [History & tail](keep-the-last-few-values.md) — the other way an accumulating value gets expensive
* [Form binding](../templates/bind-a-form-to-state.md) — the input the query came from
