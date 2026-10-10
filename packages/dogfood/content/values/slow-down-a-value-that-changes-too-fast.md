---
title: Slow down a value that changes too fast
nav: Throttle & debounce
intent: A search box that fires on every keystroke, without firing on every keystroke.
covers:
  - `throttle`
  - `debounce`
  - `identity`
  - `structural`
examples:
  - packages/dogfood/examples/cap-debounce.json
  - packages/dogfood/examples/cap-throttle.json
  - packages/dogfood/examples/identity-structural.json
---

A filter box is the case where "reading loads it" stops being free. Bind the input to a value,
derive the figure from it, and you have declared one request per keystroke. Two options cap that,
and a third stops a value waking anybody when it did not really move.

## The two caps, and what they cap

Both cap **how often the value changes**, and both apply however the change was driven.

| | Fires |
| --- | --- |
| `throttle: n` | immediately, then at most once per `n` ms |
| `debounce: n` | once the changes stop for `n` ms |

Declaring both is a build error naming the value, there being no reading under which you meant one
of them. Each value below takes them, and what drives the change is the producer's business:

| The value | What moves it | What a window collapses |
| --- | --- | --- |
| a derived value over a load | a trigger — a dependency, an `invalidate`, a `refresh`, a `ttl` lapsing | reloads |
| a value you write | a write | wakes |
| a channel | an append | wakes |
| a stream — an `async function*` body | a chunk | wakes |
| a keyed value — a body with a parameter | a key reached for the first time | starts |

## `debounce` waits for the changes to stop

{% example cap-debounce %}

*1 option, 0 markup changed* — it goes on the value that pays the cost, and the probes did not move
either.

`debounce` is right where the intermediate values are not answers — a half-typed region being the
example the whole page is built on. Five keystrokes are one load rather than five, and **the count
already held stays on screen the whole time.**

That is the `refresh()` contract rather than a new one: while the window is holding a change back
the value already held keeps being served, so the value stays `busy()` **and** `ready()` and a
figure does not blank between keystrokes. A **first** load is busy with nothing to serve — which is
the dash the card passes through once, on its way to the first figure.

The hand-written arm is where the cost shows. The window is one timer, but it arrives with two
things beside it: the flag that keeps the held figure up, and the guard that stops an answer for a
region since typed past from landing on the page.

Read on: [Loading states](show-a-value-that-isnt-there-yet.md) ·
[Reloading](decide-when-a-value-reloads.md)

## `throttle` fires first and then rate-limits

{% example cap-throttle %}

`throttle` is right where the value is being watched — a live count, a cursor position, anything
where the first update should be immediate and the **rate** is the problem. The tile takes the
first arrival at once, which is the half a debounce would have got wrong: a debounced value that
never goes quiet shows nothing at all.

**Both figures are right at every moment a reader looks**, and only one of them cost a repaint per
arrival. That is why the card's spec counts paints rather than comparing the two numbers — the
value is identical either way, and the work is the whole claim.

A window **delays**, and does not itself drop (5.9). It collapses a batch into one wake, so a
capped channel tells its readers once per window, and a `{#for}` over it keyed with `by` paints
every message the window held in one go rather than one per frame (5.23). For a value that is
replaced rather than appended to, the batch is the latest value, which is why the same rule looks
like two behaviors.

What survives the batch is what the value holds, never the window. There is no second buffer behind
a cap, so a capped value written three times in one window serves the third and the first two are
gone. Where the ones between are the point, append them to an array and trim it.

A stream takes either cap too, and the window is over how often its **readers** wake (5.17). A read
serves the accumulation as the last release left it, not the chunks the window is still holding
(5.18), while a cursor still gets every chunk (5.10). The close releases what the window holds, so
`await` resolves with the whole accumulation (2.7).

Read on: [Recent values](keep-the-last-few-values.md) ·
[Streaming data](../server/send-data-as-it-arrives.md) ·
[Channels](let-anything-publish-and-anything-read.md)

## On a keyed value the window is over starting a key

A body with a parameter is a space of values, and what a filter box drives through it is a new
**key** per keystroke, not a new value under one key. So the window on a keyed value holds back
**starting** a key it has not reached before (5.19). `search({ q })` reached for `n`, `no`, `nor`
and `north` inside one debounce starts `north` alone. A throttle starts `n` at once and, at the end
of the window, the latest key reached since.

A key the window passed over for a later one is never started and never kept (5.20). No request
goes out for `no`, and there is no entry for it left to hold. The key being held back reports
`busy()` (5.21), so the page reads a load in flight, which is what it is about to be.

A key already started is an ordinary entry. Reaching it again is a cache hit and does not wait.
What moves it after that — a dependency, an `invalidate`, a `ttl` — is capped as any value is. A keyed
channel is a keyed value, so reaching its key is held the same way, and after that the window is
over its appends, as the table says.

Read on: [Caching](load-once-per-set-of-arguments.md)

## The cap belongs on the value, not at the call site

A value that must not join a stampede says so about itself, where the knowledge is — a tag-wide
`invalidate({ tags: ['invoice'] })` cannot know what else it matched, so it is the wrong place to
decide how hard any one entry may be hit.

The one read that ignores the cap is a `bind:`. The binding wrote the value, so it sees its own
write immediately while the rest of the page waits out the window — otherwise a throttled value
under `bind:value` would snap the text back under a typist between keystrokes.

Read on: [Caching](load-once-per-set-of-arguments.md) ·
[Form binding](../templates/bind-a-form-to-state.md)

## `identity` wakes readers only when the value moved

{% example identity-structural %}

The other half of "too fast" is a value that changes without changing. Every load hands back a new
record, so by reference each Refresh is a change, and the chart redraws to show the numbers it was
already showing. `identity: structural` compares what landed with what was held, and an equal
record wakes nobody — the redraw count stands still. Record a sale first to see it move: the count
is live, and the comparison is what holds it.

`identity` decides what counts as the same value, and getting it wrong leaves the output right and
the work wrong: nothing renders incorrectly, the page just re-renders on every recompute.

**The reference is the default** (5.4), which is what JavaScript means by the same value. Declare
`identity: structural` on the value whose producer rebuilds what it hands back — a reload that
fetches an equal record, a list rebuilt from the same rows — and it collapses without waking
anybody. It is not the default because the walk runs on every write, where the wake it saves is
collected only when the payload really is equal.

It BAILS rather than guesses: a `Map`, a `Set`, a class instance, a cycle, and it answers "not
equal", so an indecisive comparison wakes readers instead of collapsing a change. `canonical` is
not this and is not an equality at all; it builds a keyed value's KEY, which has to be stable across
processes and across sides, so it sorts, drops `undefined` and allocates a string.

Write your own comparator where `structural` bails on a shape you need compared. It takes either
form: a **projection** compared with `!==`, or a **comparator** answering directly. The second exists because "same length, same elements" cannot
be projected — a freshly built array is `!==` whatever is in it.

A value you write holding an object is the case you hit first. A form binding rewrites it per
keystroke, a `refresh()` on `reactive(() => fetchUser())` returns a structurally identical user, and a
write through a member path copies down the path. Each of them is a new reference for a value that
did not move.

Every write is gated, a channel's included (5.2). A message said twice is still a change there:
it is a second element in the array rather than the same value written again. `identity` decides
when two values are one, and an append is never the same value as the array before it.

Read on: [Channels](let-anything-publish-and-anything-read.md) ·
[Derived values](derive-a-value-from-other-values.md)

## `identity` costs O(size) per production

Walking is O(size) per production — per `set`, per recompute — and it is the cost the
default accepts. A four-key record is 48 ns, and a hundred rows rebuilt over the same row
references is 373 ns because every shared element settles on the first check. Five thousand rows
all freshly built and all equal is 0.31 ms, which is the pathological end and still under 2% of a
frame. The walk that finds its difference at the last row is the one that pays without collecting.

It compares the **stored** value against the previous one, which is why it never runs per chunk — a
streaming producer has one stored value, the accumulation, materialised on the read that asks for
it (9.1). It holds one token and not a set, so it compares against the previous stored value
alone (9.3), and a value that keeps a long array is compared against one array, not against every
value it ever held.

## Next

* [Caching](load-once-per-set-of-arguments.md) — the entries a cap applies to
* [Recent values](keep-the-last-few-values.md) — an array appended to and trimmed in one patch
* [Form binding](../templates/bind-a-form-to-state.md) — the input the filter came from
