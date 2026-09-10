# The compiled renderer

## What this document is

A **plan**. It answers one question: *what does a `.abide` file become, and what runs it?*

Nothing here is decided. The four documents carry what has been decided, and a statement in this
file that turns out to constrain behaviour becomes a clause in RULEBOOK.md — after which this
document cites the number rather than keeping the sentence, because a second copy drifts and only
one of them gets fixed. Where this plan refuses an alternative, the refusal is owed a DECISIONS
entry before the code lands, not after.

Delete this file when the last stage below has landed. A plan that outlives its work is read as a
description of the code, and it is the one document nothing checks.

## The decision everything else falls out of

A compiled component is not a render function. It is a **slot table**, and three emissions from it:

| Emission | For | Shape |
| --- | --- | --- |
| static HTML | the browser | one string per template, parsed once, cloned per instance |
| byte chunks | `render` | `Uint8Array` per static run, encoded at module scope |
| addressing | both | straight-line `firstChild` / `nextSibling`, no query, no loop |

`<p>Hello {name}</p>` is one row in that table — kind `text`, static prefix `Hello `, reads
`{name}` — and the three emissions are `<p>Hello </p>`, `[b('<p>Hello '), slot, b('</p>')]`, and
`first.nextSibling.firstChild`. The two substrates share the table that produced them and nothing
else: a marker the client needs is not a marker the server has to emit.

## The cursor

A build takes its nodes from a cursor and never creates them. There is no create-or-adopt branch in
emitted code.

```js
// A TEMPLATE is a fixed-shape holder the compiler emits at module scope. `count` is the
// top-level node span, known at compile time, so the adopting cursor never counts nodes.
export function template(html, count) {
    return { html, count, parsed: undefined }
}
```

`take(template)` hands back the FIRST NODE of the span. Addressing is written from that node rather
than from a parent, which is what makes one program serve both modes — under adoption there is no
fragment to be the parent, and the served nodes are already siblings in the document.

`place(first, parent, before)` is INERT when adopting: the nodes are where they belong. This is the
uniform option CLAUDE.md prefers over a hard-coded exception — it exists on both cursors and does
nothing on one, so a call site never asks which mode it is in.

`place` is INSTANTIATION-ONLY, and that is a rule rather than a description: it runs exactly once
per instance, while the span is still held by its fragment. Moving a span that has already been
placed is `move(first, count, parent, before)` below, which is a different operation and not a
second call to this one.

```js
// packages/abide/src/ui/CLONING.ts — cannot fail: the nodes come from a string the
// compiler emitted, so this implementation carries no mismatch path at all.
export const CLONING = {
    take(template) {
        if (template.parsed === undefined) {
            const element = document.createElement('template')
            element.innerHTML = template.html
            template.parsed = element.content
        }
        return template.parsed.cloneNode(true).firstChild
    },
    place(first, parent, before) {
        // Instantiation only. A cloned span's parent is still the fragment here, so one
        // insertBefore carries every root without the fragment being held separately.
        parent.insertBefore(first.parentNode, before)
    },
    // Moving a span AFTER placement. `first.parentNode` is the real parent by then, so the
    // fragment trick above would insert the container into itself; the roots are ordinary
    // siblings and get walked. `count` is compile-time, so this never counts nodes.
    move(first, count, parent, before) {
        let node = first
        for (let index = 0; index < count; index++) {
            const next = node.nextSibling
            parent.insertBefore(node, before)
            node = next
        }
    },
}
```

The two are separate because their preconditions are: `place` requires a fragment parent and `move`
requires a real one. Collapsing them into one call with a `?? first` fallback reads as uniform and
is not — it silently does the wrong thing on the second call, and every block kind below
(`{#if}`, `{#switch}`, `{#await}`) can be a multi-root span that gets moved.

```js
// packages/abide/src/ui/Adopting.ts — stateful, one per hydration, threaded through the
// tree in emission order. The only cursor that can fail, and 41.11 is handled HERE: hand
// back fresh nodes, drop the served span, resync, warn on `abide:hydrate`.
export class Adopting {
    constructor(markers) {
        this.markers = markers
        this.index = 0
        this.node = undefined
    }
    take(template) {}
    place(first, parent, before) {}
    // NOT inert: an adopted span still reorders. The served nodes are already siblings in the
    // document, so this is CLONING's `move` verbatim — the uniform member with a real body on
    // both cursors, unlike `place`.
    move(first, count, parent, before) {}
}
```

Two implementations rather than one widened one is legitimate here on CLAUDE.md's own condition:
they have genuinely different invariants — one can fail and one cannot — and keeping them apart is
what stops the cloning path carrying dead mismatch branches on the hot path.

**The count of two is an invariant, not an accident.** Every compiled component has `cursor.take`
at one call site, so two implementations keep that site bimorphic and a third makes every compiled
template in the app megamorphic at once — a global deopt caused by a local addition, and nothing
about the third cursor's own code would look wrong. The server needs none: it walks the emitted
`stream` and never calls `build`.

The payoff is not the deleted conditional. It is that 41.11's rebuild stops being a code path — it
is `build` again with `CLONING` in place of the adopting cursor. A `{#if}` flipping to a branch
never served, a row the reconcile creates, and a navigation into a page the document never carried
are the same call with the same cursor. The case falls out of the mechanism instead of being
special-cased in it.

## A compiled component

Input is the minimal file below — written for this section, not a path in the repo. The nearest
real one is `packages/dogfood/examples/bind-text/files/src/ui/components/Contact.abide`, which
carries two bindings and a `<select>` and would bury the shape this section is about.

```html
<script>
import { state } from 'abide'

let name = state('')
</script>

<input placeholder="your name">
<p>Hello {name}</p>
```

```js
import { state } from 'abide'
import { effect, template } from 'abide/runtime'

// 33.17 applied: the newline between the two elements carries no space, so it is gone.
const PAGE = template('<input placeholder="your name"><p>Hello </p>', 2)

export default function Page() {
    // <script> verbatim. 14.7 — not tracked. 41.7 — this runs again on hydration.
    const name = state('')

    return function build(cursor) {
        const input = cursor.take(PAGE)
        const greeting = input.nextSibling.firstChild

        // 32.1. The compiled update owns the WHOLE text node, so the static prefix is
        // re-concatenated rather than addressed. See "No marker on a text slot".
        effect([name], () => {
            greeting.data = 'Hello ' + name()
        })

        // 32.6. The guard is not a dedup — writing `.value` mid-composition moves the
        // caret. Identity dedup is already paid for in the reactive layer (5.1).
        effect([name], () => {
            const value = name()
            if (input.value !== value) input.value = value
        })

        // 14.9: the write-back does not track.
        input.addEventListener('input', () => name.set(input.value))

        return input
    }
}
```

### No marker on a text slot

The usual lowering splits `<p>Hello {name}</p>` with a comment so the dynamic half gets its own text
node to survive the parser, which the server then has to emit and the client has to walk. Instead
the compiled update owns the node's whole `data` and rebuilds the constant prefix on every write. It
costs a concatenation of an interned literal; it saves a comment node per interpolation on every row
of every list, and it deletes the hydration-splitting path entirely. The saving is the claim this
section rests on and it is PROSE, not a number — CLAUDE.md budgets emitted code in DOM nodes per
list item, and that row is missing from the cost table. It is also what decides the marker fork
under "Hydration", so it is owed before either plan keeps its sentence.

The consequence to state out loud: **two interpolations in one text node are one binding over the
union of their reads**, so `{first} {last}` wakes on both. That is cheap because the write was one
`.data` either way, and it is the reason a binding names a source LIST rather than a source.

### No last-value cache per slot

Dedup lives in the reactive layer, where the `identity` option (5.1-5.6) already pays for it. A
second `if (value !== last)` in every compiled slot is a comparison already made. The gate is a
binding-run count, not an output check.

## A keyed block

Input is the `{#for}` in `examples/patch-transform/files/src/ui/pages/dashboard/page.abide`.

By 14.5 a block binding binds the VALUE, not a `Reactive`. So `{region.name}` is not a reactive read
— it is a property access on a plain object, and **a row whose slots read only the binding
subscribes to nothing**. Zero effects and zero subscriber records per row. The only reactive read in
the block is `rows` in the subject, bound once for the body per 32.25.

```js
const ROW = template('<li><span> </span><strong> </strong></li>', 1)
//                                ^          ^  placeholder text nodes: they clone for
//                                              free, where createTextNode is a DOM call
//                                              per slot per row.

// Module scope, capturing nothing — a thousand rows share these three functions and
// allocate one fixed-shape record each.
function createRegionRow(cursor, region) {
    const li = cursor.take(ROW)
    const row = new Row(region.id, li, li.firstChild.firstChild, li.lastChild.firstChild)
    updateRegionRow(row, region)
    return row
}

function updateRegionRow(row, region) {
    row.a.data = region.name
    row.b.data = region.orders // IDL DOMString conversion; String() repeats it
}

function regionKey(region) {
    return region.id
}
```

`Row` is a class because of the hot-path rule: every field the type declares is initialised at
construction, `undefined` included, and none is added later.

```js
class Row {
    constructor(key, node, a, b) {
        this.key = key
        this.node = node
        this.a = a
        this.b = b
        this.item = undefined // set by the reconcile; declared here to fix the shape
    }
}
```

## The reconcile

What lands: common-prefix and common-suffix trims, then pure-insert and pure-remove fast paths, then
one `Map` over the OLD MIDDLE only, walked backwards from the tail anchor so `before` is always a
node already in position. A row whose `nextSibling` is already `before` is not re-inserted —
`insertBefore` on a node already there is still a move. Every reorder here goes through the cursor's
`move`, never `place`: a row is placed once, at instantiation, and moved every time after.

What does NOT land: the longest-increasing-subsequence pass. LIS turns "move everything not already
in position" into a provably minimal move set, and it is the standard thing to reach for. It is also
about forty lines of machinery on a shared path, and the case that justifies it is narrow — a
rotate, where the naive walk moves n-1 elements and LIS moves one. Per the branch rule it earns its
place with a measured ratio at the n where a rotate crosses a frame, asserting ELEMENT MOVES. This
design has no per-row markers, so the count cannot be inflated by comment moves the way CLAUDE.md's
marker-elision note describes — but the count is still a count, and it is converted to a cost before
anything is written.

The two distinguishing cases are different cases and both are owed. A **two-row swap** prices it: a
full reverse cannot tell a minimal reconcile from `replaceChildren`. A **full reverse** is what
catches a transposition the swap is blind to. Compare the whole resulting key order, never its ends.

## The server arm

Static chunks are encoded once at module scope. `render` yields bytes (35.5), so a per-request
`TextEncoder` pass over constants is work with no reason.

The compiled `stream` touches every reactive the template reads before it walks a slot (41.2), which
the compiler can do because the slot table already names every read. A value still in flight opens a
sink and the render continues past it (41.4), and the fill batches by flush rather than by
production (35.10, D37).

```js
export async function* stream(context) {
    const rows = context.rows
    yield CHUNKS[0]
    if (rows.pending()) {
        yield sink(context, 0)
    } else {
        for (const region of rows()) {
            yield CHUNKS[1]
            yield escape(region.name)
            yield CHUNKS[2]
            yield escape(region.orders)
            yield CHUNKS[3]
        }
    }
    yield CHUNKS[4]
}
```

`escape` and `sink` must not be reachable from the client entry's static closure. That is a
build-layout requirement rather than a preference: the compiler emits the two halves into separate
modules, and the seam split enforces it only if it does. An import edge is priced by the module it
lands on, so one `#shared` re-export of either drags the whole server arm into every page.

**`sink` has four plans touching it and no owner, and this is where that has to be settled.** This
plan CALLS it; `COMPILER.md` allocates sink ids on the IR walk and emits the sink table;
`SERVER.md`'s `flush` waits on a blocking sink for one flush (41.4, 41.5) and its `Scope` holds the
sink table from stage 1; `REACTIVE.md` defers 14.12's sink-registering reader to "SSR" with no phase
number attached. Every plan assumes one of the others builds it.

The split that follows from the seams: the sink OBJECT is `#server` — it exists only inside a
render, and nothing on the client can reach it without the edge above. The compiler owns the ID
allocation and the table's shape, because both are compile-time lists. `SERVER.md` owns the
scope-held table and the flush interaction. `REACTIVE.md` owns 14.12's reader and owes it a PHASE,
not a deferral to a stage in another document. `stream` here is the only caller. Nothing about that
is decided until the four say the same thing in four places — which is the argument for it being
one clause and three citations instead.

## Hydration

41.10 needs settling before this part is written, AND `COMPILER.md` DECIDES IT THE OTHER WAY. That
plan takes the marker list to BE the compiled op indices, which makes a mismatch "op *i* expected
kind K" and localises it to the enclosing block by construction (41.11); this one emits a marker per
block and none for a text or attribute slot, under which four of the five op kinds have no marker to
mismatch against and the message can only be "block *i*". Two plans, one clause, two mechanisms,
and until 41.10 settles neither sentence is load-bearing. The trade is stated where it can be
priced: the block-only arm saves a comment node per interpolation on every row of every list, which
is a DOM-nodes-per-list-item number and belongs in the cost table below rather than in prose.

The reading this plan builds to: the document carries an ORDERED MARKER LIST **inline**, the
hydration program consumes it in emission order as setup re-executes (41.7), and node handles come
from exactly one linear comment walk zipped against that list. O(markers) once for the page, and at
no point is a freshly rendered tree compared with the served one.

**Inline, and not "in the seed" — which is what this paragraph used to say, and it was a collision
rather than a shorthand.** `SERVER.md` has *the seed* meaning one specific thing: a server-side
buffer of the render scope's memo entries, addressed by an id, TTL'd, and per D39 explicitly NOT
embedded in the document. A marker list cannot live there. It would be unavailable until a round
trip has completed, expire on a TTL nobody has chosen, and be refused to a second visitor — while
the hydration program needs it before its first fetch, on every load, for every visitor. Two
mechanisms under one word, in two plans, neither citing the other. The marker list is DOCUMENT
PAYLOAD; the seed is a SERVER BUFFER; the cost model in the next paragraph is the document one.

Two things to settle with it, both of which 41.10 as written already leans on. A LINEAR COMMENT WALK
IS WALKING THE DOM, and 41.10 has the client walk the marker list the document carried rather than
the DOM — so either the walk is not what 41.10 refuses and the clause should say so, or the handles
come from the addressing rather than from a scan. And if the list IS the op indices, the client
program already holds it statically from its own module and the document carries nothing; emitting
it inline is per-request bytes on every page. `COMPILER.md` assumes the first, this plan the second,
and they cannot both be free.

Under this design markers exist only for BLOCKS — `{#if}`, `{#switch}`, `{#await}`, `{#for}`,
component boundaries, sinks — one comment each, and none for a text or attribute slot. A
fixed-shape row is found by counting its known span from the block anchor; only a nested block whose
size varies needs an anchor of its own.

### The initial run on adoption

A binding that runs on adoption writes a value the server already wrote. Three arms:

1. **Write unconditionally.** One redundant `.data` per text slot, once per hydration.
2. **Compare in emitted code.** A string compare on every update, forever, to save the writes in 1.
3. **Do not run the binding at all when adopting.** The compiler emits the source list for each
   slot — it already has it from the table — so the subscription is established without evaluating
   the body, and the first run is the first real change.

Whichever arm runs, the slot's write reads the BRAND before the thenable test. A `Reactive` is
thenable (1.5) and 1.7 has a load told apart from a value take the `Reactive` as a value, so a slot
written as `isThenable(v) ? await v : v` silently settles a live value to one snapshot and never
updates again. The order is `isReactive(v)` first, then `isThenable(v)` — the same
`#shared` guard the server arm uses, imported rather than re-derived. The template slot is the one
place in the framework where both tests are true of the same value, so it is the one place the
order is load-bearing rather than stylistic.

Arm 3 is what this plan takes, with arm 1 as the fallback wherever the compiler cannot enumerate the
reads statically. The asymmetry is what decides it against arm 2: once per page against every update
for the life of the page. This is internal to the compiled slot binding and not `watch`, so 12.2 is
untouched and no clause is owed — but it is the highest-uncertainty part of the plan, and the
hydration measurement below is the one that confirms or kills it.

### The last-value cache, and why the refusal is thin

`{first} {last}` compiles to ONE binding over the union of its reads, so a wake for `first` re-runs
the binding and rewrites the whole `.data` — including the part `last` contributes, which did not
change. The refusal above points at the reactive layer's `identity` dedup (5.1-5.6), but that
governs when a reader is WOKEN; it says nothing about whether the DOM write inside a woken binding
was redundant. A binding-run count cannot see the difference, so the gate named for this refusal
does not test it.

CLAUDE.md's rule cuts the other way here — "when a path can compare, key or skip instead of
touching a node, that is the cheaper arm even when it adds branches" — so the refusal owes a ratio
it does not have: redundant `.data` writes per wake, multi-read slots against single-read slots, on
the dogfood list page. If the multi-read case is rare the refusal stands on frequency rather than
on 5.1, and the DECISIONS entry should say so.

## What it costs

**PROJECTED, not measured.** Nothing below has been run — these are the targets the design is
committing to, and the table is here so the first run has something to falsify. A row with a
measured number replaces its projection and says which lane and substrate produced it; until then
none of this is a claim.

Against the hand-written arm in `packages/dogfood/examples/patch-transform/vanilla/dashboard.js`,
which is 65 lines and does `replaceChildren` with a fresh `<li>` subtree per region on every wake.

| | vanilla | compiled (projected) | lane |
| --- | --- | --- | --- |
| LOC, this page | 65 | ~30 emitted, plus the reconcile in the runtime | — |
| Allocations per row, steady state | 4 nodes and a closure, every wake | 1 string per numeric slot, 1 `Map` per wake over the old middle | `harness/measure`, both substrates |
| Bindings per row | 0 | 0 — the block binding is a value (14.5) | `harness/measure` |
| Element moves, two-row swap of 500 | 500 | 2 | `harness/measure`, both substrates |
| Runtime exports added | — | `template`, `effect`, `block`, `reconcile`, `CLONING`, `Adopting` | — |
| Branches added to the reconcile | 0 | 6 — prefix trim, suffix trim, pure insert, pure remove, `Map` middle, `nextSibling !== before` | — |
| Dispatches added per instantiation | 0 | 1, bimorphic | — |
| DOM nodes per list item | 1 `<li>` + subtree | the same, plus 0 markers | `harness/measure` |
| Microtask ticks per row | 0 | 0 | `harness/measure` |

The allocation row is NOT zero and the earlier draft of this table said it was. `row.b.data =
region.orders` is an IDL `DOMString` conversion — a string per numeric slot per kept row per wake —
and the reconcile allocates one `Map` over the old middle. "0 on a kept row" was the intent read
back as the result, which is the thing a projected table exists to stop.

Six exported names is the price, and every one is in the client entry's static closure, so it is
paid on every page. That number is the one to defend or shrink.

## What must be measured before it lands

1. **Name the share first.** Reconcile time as a fraction of click-to-paint on the dogfood list
   page, written down before a line of the reconcile is written. Two rewrites of a reactive core
   have already landed as no-ops here for skipping this. **Lane: `harness/engine`** — this is
   `shares()` over CDP, chromium only, driven from the playwright side, and it is NOT available
   inside a case body. Taken with `performance.now()` instead it returns the frame: click → paint
   is frame quantised, so every implementation under 16.7 ms reads 16.7 ms and the fraction is
   unobtainable. n = 500 rows, which is where the reorder crosses a frame on the vanilla arm.
2. **`take` against an inline clone**, as DOM calls per row in `harness/measure` — the lane that
   reads in both substrates. The ratio is against the vanilla arm; absolute ms from a DOM emulator
   describes the emulator.
3. **Hydration cost of a 500-row page**, arm 3 against arm 1 above, in two numbers with two lanes:
   redundant `.data` writes per row in `harness/measure`, and document bytes in `harness/server`.
   "Under the floor" means within 1.05x of arm 1 on the write count, stated so it can be missed. If
   the redundant writes are under it, arm 3 is machinery for nothing and the fallback becomes the
   whole design.
4. **A fuzz whose step arity matches the guards.** The prefix/suffix trims are bracketing guards and
   a one-change-per-step fuzz cannot reach them — the summary and the truth agree by construction.
   Steps make 2 to 5 changes at once, and each step compares the WHOLE resulting key order.
5. **Every gate gets the revert.** "Zero bindings per row" and the move counts are both *does less
   work* contracts where the output is identical either way, so a green first run proves nothing.
   Subscribe a row body to something and watch the binding count go from 0 to 2n; delete the
   `nextSibling !== before` guard and watch the swap go from 2 moves to 500. The number the gate
   reports with the fix out is what the gate is worth.

## What the docs owe

RULEBOOK, as clauses under a group that declares itself FREE-STANDING — none of these is a name an
app writes, so REGISTRY gains no row:

* a build takes its nodes from a cursor and never creates them;
* a text slot carries no marker, and a marker is emitted per block;
* addressing is resolved at compile time and is straight-line from the span's first node.

DECISIONS, one entry per refusal, each naming what it assumes and what it decides. The first three
were already here; the last three are refusals the body makes and this ledger did not carry, which
is the gap CLAUDE.md's preamble calls out — a refusal is owed an entry before the code lands.

* **the create-or-adopt branch in emitted code**, refused for the rebuild-path collapse rather than
  for the deleted conditional;
* **the split text node with a comment marker**, refused for the node per interpolation per row;
* **LIS in the first reconcile**, refused pending the rotate measurement;
* **the last-value cache per slot**, refused for the reactive layer's identity dedup — and this one
  is the weakest of the six, see below;
* **arm 2, compare-in-emitted-code on adoption**, refused for once-per-page against
  every-update-forever;
* **`createTextNode` per slot**, refused for the cloned placeholder text node already in the span.

## Stages

1. The compiler front end: parse to the slot table. No emission. Gated by a test that reads the
   table off the two dogfood pages above.
2. The server emission and `render`. This is the half the dogfood app already needs, and it needs no
   cursor, no reconcile and no hydration.
3. `CLONING`, `template`, `effect`, and the client emission for text, attribute and event slots.
   Measurement 1 lands before this, not after.
4. `block` and `reconcile`. Measurement 4's reverts land with it, in the same change.
5. `Adopting`, the marker list, and 41.10's clause settled first.
