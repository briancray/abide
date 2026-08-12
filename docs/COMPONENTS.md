# props, and what a component instance IS

A component call is CARRIED to the position that shows it rather than made where it stands, so the
instance outlives a re-render: the view runs once, its props are cells the position writes, and the
child's own `state` is never rebuilt. This is the record of why, what it cost, and what it settled.
The spec of the surface is `docs/SPEC.md` under "Components"; this file is the reasoning behind it.

## the bug it fixes

A prop that CHANGED silently discarded the child's own state. Measured, not inferred:

```ts
const Card = ({ n }: { n: number }) => {
    const own = state('initial')          // the child's own state
    written = (v) => own.set(v)
    return html`<b>${() => `${n}/${own()}`}</b>`
}
const outer = state(0)
mount(host, () => html`<div>${() => Card({ n: outer() + 1 })}</div>`)

written('EDITED')   →  "1/EDITED"
outer.set(1)        →  "2/initial"       ← the write is gone
```

That is an input somebody typed into, a panel they opened, a row they selected. Nothing warned, no
type caught it, and the output looked correct — the prop really did update.

## it was never really about props

Worse than the repro above says. A KEYED list of the same `Card`, compiled from
`{#for r of rows() by r.id}<Card n={r.n}/>{/for}` — which emitted
`${() => rows().map((r) => keyed(r.id, html`${() => Card({ n: r.n })}`))}`, so this was the real shape
and not a hand-rolled stand-in:

```
mounted    1/initial  2/initial  3/initial
edit row 2 1/initial  2/EDITED   3/initial
rows.set([1,2,3,4])   1/initial  2/initial  3/initial  4/initial   ← every row reset
```

**No prop changed.** `n` was the same number for rows 1–3 across the append. What changed was the
LIST, which re-ran the thunk that renders the rows, which built a fresh `() => Card(…)` closure per
row, which is a new value in the slot — so every row's effect re-ran, every `Card` was called again,
and every `state('initial')` inside made a new cell. The keyed reconcile did its job and moved the
right DOM; the state was never in the DOM.

So the rule was not "a computed prop resets the child". It was **a component loses its state whenever
the thunk that renders it re-runs**, and a prop is only one of the things that can cause that. A list
gaining a row does it. Anything an enclosing thunk reads does it.

That is what ruled out every design that adjusts what props CARRY.

## what it cost

Appending ONE row to a keyed list of stateful `Card`s. The counter is view calls, which is the honest
unit here: an instance that survived and one rebuilt with the same props paint identical characters,
so nothing about the output can tell them apart.

| rows | view calls per append, before | after |
| --- | --- | --- |
| 3 | 4 | **1** |
| 200 | 201 | **1** |
| 1000 | 1001 | **1** |

The number GROWING with n was the tell: an O(n) cost on an op that is O(1). At a thousand rows the
rebuild was the whole of the op — a thousand component instances destroyed and rebuilt in JS to
produce output byte-identical to what was already on screen, which is CLAUDE.md's "the wrong
implementation still produces the right output" in the exact shape a work counter exists for. The DOM
counters said nothing: four inserts either way, because the keyed reconcile touches only the new row.

Both columns are `demos/client.ts`, under "a keyed list GAINING a row rebuilds nothing", and the
before column is what that case reports with the instance reuse in `component_` taken out.

## the designs that do not work

Kept because each is the obvious next idea, and each fails for a reason worth not rediscovering.

**A — the status quo.** Cell props were live and never re-called; value props stayed fresh by
re-calling. Cheap, and it carried the bug with no warning available: the compiler cannot tell a child
that has state worth keeping from one that does not.

**B — every reactive prop is a thunk.** `n={n + 1}` compiles to `Card({ n: () => n() + 1 })`, so the
call reads nothing. **B does not fix the bug.** It stops a PROP from making the enclosing thunk
reactive, and that thunk still re-runs for every other reason: the list above resets every row under B
exactly as it does under A, because the reset comes from the list moving. It also costs a closure per
reactive prop per instance, held for the child's lifetime.

**C — values unless bound.** `n={n}` passes a `number`; `bind:note={note}` passes the cell. The
simplest rule to say, and it makes the reset UNIVERSAL rather than occasional — under A only computed
props re-called, under C every prop reads, so every prop re-calls.

## the design: the position holds the instance

`Card(...)` was a plain function call, so there was no such thing as "this component instance" for
state to belong to. Nothing that adjusts what props carry can reach that; the fix is what makes
re-rendering the parent non-destructive.

**abide already did this one level up.** A page with its own state, across a navigation from
`/users/1` to `/users/2`, keeps it: `outlet()` reads the route's NAME and the adoption counter and NOT
the params, so a navigation within one route never re-runs it, while `route().params.id` read inside
the page's own thunk moves. Two rules, and they are the two a component needs: **what changes crosses
the boundary as something the child READS**, and **the boundary's own dependency set is narrow enough
not to re-run for the change**. The router gets the second by reading a name; a component cannot,
because what re-runs its thunk is the parent's own render. So it gets an identity instead.

```
<Card n={r.n}/>       →    ${() => component(Card, { n: r.n })}
```

`component()` builds a marker — a `Component`, alongside `Awaited`, `Boundary` and `Streamed` — and
the `ChildPart` that shows it is what interprets it:

```
component_(block):
    if this position already holds an instance of the SAME view:
        write each prop into the cell it was called with, and stop
    otherwise:
        make a cell per prop, call the view ONCE (untracked), paint what it returned, hold it
```

Four things fall out, and three are deletions:

- **The parent keeps passing plain values.** No thunk per prop, no closure per prop per pass. That is
  what B was going to cost, and a closure handed in per pass could not have worked anyway:
  `rows().map((r) => …)` builds `() => r.n` over THAT pass's `r`, so an instance caching the first one
  reads a row object since replaced.
- **The declared-type rule GOES.** "declared `State<T>` → live, declared `T` → snapshot" no longer
  decides anything about liveness, because every prop is live. It decides only whether `bind:` may
  write, which is what it was always really about.
- **A prop that did not move wakes nobody**, free, from the cell's own identity check.
- **`state()` inside the body needs no change**, because the body is not re-run. This is where the
  design diverges from React's: nothing has to match cells by call order.

### what a prop is, on each side of the seam

Both substrates wrap. `cellProps` lives in `$shared/html.ts` and is called by the client's
`ChildPart` and by the server's `Component` arm, so **what a component receives is cells, always**. A
server that handed the plain values over would work for every compiled `.abide` file — those bind
through `propCell`, which would make the cells — and break every hand-written `.ts` component, which
would then be reading `who()` on a string. One rule is cheaper than that exception, at one cell per
prop per component per snapshot render.

Two things pass through unwrapped, and `Props<T>` makes the same two exceptions at the type level:

- **an existing source.** `bind:note={note}` needs the child to hold the very cell the parent does.
- **a function.** `@click={onclick}` attaches the value, and a cell holding a function would attach
  the cell.

### the destructure, and why it is rewritten

This is the part the first attempt stopped on. `Props<T>` maps `footnote?: string` to an OPTIONAL
`Cell<string | undefined>`, so a caller who omits it leaves the local `undefined` and `{#if footnote}`
compiles to `footnote()` on nothing. `class: className = ''` is worse — the local is
`'' | Cell<string>`, and only one of those is callable.

So the pattern is REWRITTEN rather than passed through. Each prop that is data moves out of it, and
its default moves to where the value it stands in for is:

```ts
const { class: className = '', footnote } = props<Card>()

    →   const { class: $className, footnote: $footnote } = args
        const className = propCell($className, '')
        const footnote = propCell($footnote)
```

`propCell` is nearly always a pass-through, because `cellProps` already made the cell. What it is FOR
is the prop that never arrived: a call site that omits an optional prop emits no key for it. The
default is derived rather than folded in once, so an `undefined` arriving LATER on a live cell still
reads as the default. A rest element and a nested pattern are left alone — neither was ever a cell, so
both keep whatever the caller passed.

Which props get this is decided SYNTACTICALLY, from the declared type's own text, because nothing in
the emit path may need a type-checker. Three answers, and the DEFAULT is "cell": a FUNCTION member is
a callback, a `KeyedMemo`/`KeyedChannel` is a handle a prop cell cannot stand in for, and everything
else — a member this cannot read at all included — takes the common rule. A function type reached
through a NAME (`onclick: Handler`) reads as a cell and is the one hole, for the reason an imported
props type has always had one.

### an inline `{#component}` is still called

`{#component Row({ n }: { n: number })}` has no `<script>`, so there is no setup to run once and
nothing to keep — carrying it would buy nothing. Its parameter type is also written by hand, and it
says `n` is a number, which it is. The compiler knows which names are inline because it hoisted them.

## the gate

Six cases, and each was verified by taking its mechanism out and watching the number go back — not
by watching it pass, which a case authored green does on its first run whether or not it tests
anything.

| case | with the mechanism out | wanted | where |
| --- | --- | --- | --- |
| a computed prop changes | `2/initial` | `2/EDITED` | `demos/client.ts` |
| a keyed list GAINS a row | 4 view calls (201 at 200 rows, 1001 at 1000) | 1, at every size | `demos/client.ts` |
| a keyed row MOVES | `3/A 1/B 2/C`, with the key dropped | `3/C 1/A 2/B` | `demos/client.ts` |
| an instance LEAVES the position | stuck on `gone` | a NEW instance on return | `demos/client.ts` |
| a component is HYDRATED | `[object Object]`, mismatch, 2 nodes built | adopted, 0 built | `demos/hydrate.ts` |
| a `State` prop is passed THROUGH | the parent's cell never moves | the child writes the parent's own cell | `demos/client.ts` |

Two of those were found by writing the gate rather than by reasoning:

- **the fourth.** A part that paints something else was still holding its instance, so toggling a
  component away and back reused it — and the reuse path does not paint, so the slot stayed on the
  text it had swapped to. The instance is now dropped in `clearExcept`, which every "showing
  something else" path already goes through, and `component_` assigns after its own paint rather than
  before.
- **the fifth.** `take` — the adoption walk — had no `Component` arm at all, so the marker fell
  through to the text arm and hydrated as `[object Object]`. Nothing in the tree caught it: the site's
  own pages hydrate components in a browser, and no test did.

The append and the reorder are a PAIR, the way a full reverse and a two-row swap are for the
reconcile. The reorder needs a distinct edit per row and a rotation rather than a swap: written with
three identical edits and the permutation `[3,2,1,4]`, an UNKEYED list passed the whole case, because
a positional reuse and a travelling identity agree on every row whose state is indistinguishable.

## what is left

- **`bind:` on a component prop** in a `.abide` file. The MECHANISM is gated — `cellProps` passing an
  existing source through, so the child writes the parent's own cell — but through a hand-written
  caller. The compiled spelling reaches the same call and has no case of its own.
- **a `...spread` whose key set grows** after setup has no cell to write the new key into, because the
  child bound its locals once. It is reported on the `component` log channel rather than dropped
  silently; nothing yet decides whether that is the right answer or whether the shape should be
  refused at compile time.
- **the SSR cost of `cellProps` — MEASURED, and it is about half the render.** 200 components of four
  props each, to a string, against a hand-written concat producing byte-identical markup. Bun/JSC is
  the real server substrate, so these are the runtime rather than an emulator; run twice, and the arms
  do not overlap.

  | prop wrapper | render | per component | vs hand-written |
  | --- | --- | --- | --- |
  | `state()` per prop — as shipped | 82.6–88.6 µs | 413–443 ns | 5.5–5.8x |
  | a bare `() => value` per prop | 38.6–47.5 µs | 193–237 ns | 3.1–3.6x |

  A cell is a `Node`, a callable, `set`/`peek`/`invalidate`, and the eleven properties `attachAsync`
  writes — about 50 ns each here, 800 of them, and roughly half the op. The comparison arm is not a
  proposal: it is what says the cost is the CELL rather than the wrapping, because the child reads
  `tone()` identically under both and the bytes out are the same.

  What a cheaper server wrapper would give up is the rest of the surface. A `bind:` prop is passed
  through untouched either way, and a `set` on a prop cannot mean anything in a snapshot — but a
  PROBE can be written (`{#if note.pending()}` on a prop reads `false`, correctly, only because the
  prop is a real cell), and a hand-written `.ts` component may call `peek`. So the trade is a
  substrate-shaped exception against the rule the build chose deliberately: a component is written
  once and runs in both places. Worth taking only with the fraction of a REAL page's render in hand —
  this page is components and nothing else, which is the most favourable possible shape for the
  claim.
