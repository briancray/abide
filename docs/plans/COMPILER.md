# Compiler plan

How the `.abide` compiler is built, and what it rests on.

## What this document is

A **plan**. It answers one question the four documents do not: *how is this built?* The four
answer what a name is, what must hold, what was refused, and how it sounds. None of them is
allowed to carry an implementation, and an implementation this size decided in a session that
never wrote it down is decided twice.

A plan is not a fifth decided document. Every part of it that turns out to be a REQUIREMENT
belongs in RULEBOOK, its name in REGISTRY and its refused alternative in DECISIONS, and the
section here is deleted when it lands there. What is left over is sequence, measurement and
judgement, which is what a plan is.

Every number below was measured, on the date and version named. Three probes are reproduced at the
end and the table marks which rows they cover; a row marked *(no probe)* was observed once and is
not reproducible from this file, which is the difference between a measurement and a note. They
are here because nothing runs them yet — the moment `harness/server` can, they move there and this
section cites the lane instead. NOT `harness/measure`: these are build-time µs on bun, and the
measure lane counts DOM calls from inside a page.

## What the compiler owes

### Artifacts, per `.abide` file

| Artifact | Clauses |
| --- | --- |
| A server render program: an async generator of bytes, with sinks | 35.5, 35.7-35.10, 41.1-41.5 |
| A client program that re-executes setup and walks a marker list | 41.7, 41.10, 41.11 |
| Scoped CSS, and the scope reached through `adoptedStyleSheets` | 34.3, 34.4, 34.6, 34.7 |
| `<head>` contributions, hoisted and keyed | 39.1-39.5, 39.7 |
| Whether the app uses view transitions, off the compiled `<style>` blocks | 39.9 |

### Artifacts, per project

| Artifact | Clauses |
| --- | --- |
| The route table every generated surface derives from | 19.1, 19.2, 20.1, 38.9 |
| A generated `Rpc` wrapper per handler, carrying method, address and description | 16.30, D17 |
| A `Schema` derived from the type annotation and the argument defaults | 19.11, 19.12, 19.13 |
| Content-hashed chunks and a manifest | 38.5 |

### The type-directed sites

Five, and the list is closed. Everything else in the grammar is decided by the parse.

| Site | Decides | Clauses |
| --- | --- | --- |
| A name | read, or hold | 31.1, 31.3 |
| A member CALL on a reactive name | the API, the mutator lift, or the value's method | 31.8, 31.14, D80 |
| `props` | a fixed accessor per key, or the dynamic form | 33.10, 33.11 |
| A handler with no `schema` | the derived `Schema` | 19.11, 19.12 |
| A handler's return type | whether it carries a `Reactive` | 16.43 |

### The static refusals and warnings

5.17, 10.2, 11.32, 11.39, 14.14, 14.15, 15.11, 16.31, 16.43, 19.2, 31.4, 31.16, 32.27, 33.1,
33.2. Fifteen, of which four are warnings.

32.27 rather than 32.17 because this plan withdraws 32.17 below — the count is the same, and the
list is the one that holds AFTER this plan lands.

## The substrate, measured

TypeScript 7.0.2, macOS arm64, Bun 1.4.0, 2026-09-08. The checker is a Go process. The JS side
gets a scanner, a factory and a visitor, and **no parser** — so a parse, an AST node and a type
are all things that cross a process boundary.

| Probe | Result |
| --- | --- |
| `getTypeAtPosition`, 300 positions, one call each, async client | 88.9 / 100.4 µs per query |
| the same 300 positions in one batched call | 3.8 / 4.1 µs per query — **24x** |
| the same, sync client under the FIFO shim below | 51.3 / 60.5 / 55.3 µs per query *(different transport — see below)* |
| batched, sync client | 3.5 / 3.5 / 3.6 µs per query — **14-17x** |
| `updateSnapshot` cold, async | 15-37 ms *(no probe)* |
| `getSemanticDiagnostics`, first call on a 305-line file | 13.7 ms, 0.2 ms cached *(no probe)* |
| snapshot and recheck after a one-file edit | ~15 ms *(no probe)* |
| nine conditional-type answers, one batched call, cold | 1.15 ms *(one cold sample, not run twice)* |
| a file existing only in the virtual FS, typed through `readFile` | resolves |
| `typescript/unstable/sync` under Bun, as shipped | fails: `stdout._handle.fd` |
| a child pipe's fd, under Bun | not exposed, by any spelling |
| the sync client over a socket | refused: spawn only |

Two readings decide the architecture:

**The cost is per round trip, not per query.** Batching is worth 24x async and 14-17x sync. The
sync lane MEASURED at half an unbatched query and level on a batched one, so a synchronous API is
not what makes the type layer affordable, and waiting for one is not a plan. The halving is not
attributable, and the conclusion does not rest on it: rows 1-2 ran through the shipped async
channel and rows 3-4 through a FIFO shim written for this probe, so the comparison is two
TRANSPORTS, not sync against async. What holds either way is the batched pair, where both
transports land at 3.5-4.1 µs — the round trip is the unit whichever one carries it.

**Nothing about the checker is cheap enough to ask lazily.** A lowering that asks the checker at
the site it is deciding pays 89 µs for the answer, so a page with 400 such sites pays 36 ms in
round trips alone. What one batched call costs for the same 400 is NOT measured: the 3.8 µs above
is `getTypeAtPosition` over plain `const` declarations, and the only conditional-type figure in the
table is nine answers in 1.15 ms — 128 µs each, 34x that rate, on the inference the checker is
slowest at (see "Ask for answers"). Extrapolating either rate to 400 holes is the arithmetic that
decides this architecture and neither is the right one. THE MEASUREMENT TO TAKE FIRST is 400
conditional-type holes in one call, reported cold and warm so the fixed cost of the call is
separated from the marginal cost of a hole. The round trip is still the unit and the conclusion
probably survives; the number quoted for it does not.

## The architecture

### Plan, answer, emit

Three passes. The middle one is the only one that touches the checker.

**A. Plan.** Synchronous, local, no checker. Scan the file, and build one tree over markup, TS
regions and styles. Structure is fully decided here: elements, blocks, keys, sink ids, the scope
token, head contributions, marker indices. Anything a type decides does not branch — it
allocates a HOLE, which is a position, a question, and the answer to take where the type does
not resolve.

**B. Answer.** One batched wave per file. Every hole's position goes out in one call, and every
reply reduces to a short string. Nothing else about the checker's world leaves this pass.

**C. Emit.** Synchronous, local, pure. `emit(tree, answers)` builds the IR and the IR builds both
programs.

What the split buys, in the order it matters:

* **Types enter at one place, as data.** The failure mode of an out-of-process checker is that
  the answer did not come back, and it is handled once rather than per lowering.
* **Pass C is testable with no checker at all.** Hand it a fixture answer table. That is most of
  the compiler's tests running with no child process, which is also what makes an allocation or
  op-count assertion over the emit honest.
* **Incrementality is a hash.** The cache key is the source hash and the answer table hash. An
  edit upstream that moves no answer reuses the emit, which is far finer than recompiling a file
  because something it imports changed.
* **The answer table is a diff.** What a compiler change did to a project is a diff of answers,
  which is reviewable in a way "the output moved" is not.

### The projection

The checker has to see something. The obvious move — rewrite the template into TypeScript so it
checks — is the one to refuse: it forces read-versus-hold to be decided BEFORE the checker is
asked, and that is the decision the checker is for.

The projection is instead the file's `<script>` regions verbatim at their original offsets, plus
a region holding the template's expressions, transcribed verbatim inside a generated scope. The
mapping is identity for everything the author wrote, and one delta per expression elsewhere.

The scope wrapper is what makes the sugar check without a rewrite:

```ts
__scope({ invoice, count }, ({ invoice, count }) => {
    ;(invoice.total)
    ;(count + 1)
})
```

`__Sugar<T>` maps each binding: a `Reactive<S>` becomes `ReactiveApi<S> & { [K in Exclude<keyof
S, keyof ReactiveApi<S>>]: S[K] | undefined }`, and everything else is itself. `| undefined` is
31.12, and it is then a fact of the type rather than a branch in the compiler.

TWO DEFECTS IN THAT SHAPE, both found by reading it against the clauses rather than by running it:

`Exclude` is cited to 31.8, which is the right clause for a CALL and the wrong precedence for a
READ. The intersection puts `ReactiveApi<S>` first and excludes its keys from the value side, so
wherever `Stored` carries a key the API also has — `error`, `done`, `pending`, `set` — a bare
`{invoice.pending}` types as the API member. 31.7 requires a property access to reach the value and
MUST NOT reach the API, and no clause makes 31.7 lose to 31.8. This is D80's refusal ("a payload may
carry a `push` of its own") arriving at the member site. The projection needs the value first and
the API reachable only through the call answer, which is the same split the site table above now
makes; whether one mapped type can carry both views is open.

`S[K] | undefined` is flat, so a chain is a type error where 31.12 licenses a short-circuit:
`invoice.customer.name` is TS18048 in the projection, and the second wave is a DIAGNOSTICS wave, so
that error is reported to an author writing a spelling the rulebook allows. The mapped type has to
recurse.

Measured, one level deep and against the defective shape: `invoice.total` types as `number |
undefined` and `invoice.pending()` as `boolean`, with no diagnostics and no rewriting. The probe
that matters has not been run — a payload whose keys collide with the API, and a two-level access —
and neither claim above should be believed until it has.

This view belongs to the projection and NOT to the published `Reactive`. A `.ts` file has no
lowering, so a published value-member surface would name members the runtime does not carry —
true only under a Proxy, which is a trap per property read on a path walked per row.

### Ask for answers, not for types

Each type-directed rule is a conditional type resolving to a string literal, declared beside the
runtime types. The projection's question region holds one `declare const` per hole, and the
batched wave reads literals back.

Measured, nine holes, one call, 1.15 ms cold:

```
Read<Reactive<Row>>               "read"     Member<number, 'toFixed'>      "plain"
Read<number>                      "hold"     Props<{ title: string }>       "fixed"
Member<Reactive<Row>, 'total'>    "value"    Props<{ [k: string]: unknown }> "dynamic"
Member<Reactive<Row>, 'set'>      "api"      Read<ReturnType<typeof f>>     "read"
Member<Reactive<Row[]>, 'push'>   "lift"
```

The fourth row is 31.8, the fifth is 31.14 and D80's type-directed lift, in three lines of
conditional type rather than in compiler logic. What this is worth:

* The compiler holds no type-relation code. It never asks whether one type is assignable to
  another, and it never walks a `Type` — every member of one is another round trip.
* A rule change is a TYPE change, checkable by the framework's own type tests.
* Every conditional's fallback branch is the widening answer, so the "we did not know" arm is
  declared per rule rather than inferred per site.
* Answers are strings, so the table hashes, caches, diffs and serialises.

The risk to state: it rests on conditional-type inference, which is where the checker is
slowest, and a mistake in one of those types reads as an obscure answer rather than as an error.
The defaulting rule is the mitigation — an error type is a widening, never a build failure.

### The answer is taken at the binding

31.1 reads as a question per use. Ask it per BINDING instead: the parse already built the scope
tree, so the uses inherit. It is faithful — every name has a binding, and D28 put the `Reactive`
there — and it is what keeps the wave small, a page's uses outnumbering its bindings by an order
of magnitude. Member calls and props stay per-site, the member's own type being what decides.

### Two waves

The first wave is the per-binding questions, and it does not need the expression region to check
cleanly. The compiler then rewrites that region with the answers it got, and the second wave asks
for DIAGNOSTICS over the rewritten projection — which is how an author's own type error inside a
template expression is reported at all.

The rewrite inserts text the author never typed, and a diagnostic landing inside it is the case
38.22 would govern — a clause this plan PROPOSES below, not one that is live.

### One IR, two backends

A template lowers ONCE, into a flat op list — `text`, `openElement`, `attr`, `sinkText`,
`blockStart`. Two backends generate from it: one writing bytes, one binding nodes.

The alternative is an SSR emitter and a DOM emitter with a lowering each, which doubles the
machinery and puts every isomorphism bug where it is hardest to see — a construct lowered two
ways by two pieces of code that were meant to agree.

It also makes two requirements fall out of one structure rather than being two special cases:
`<head>` hoisting (39.3) and view-transition detection (39.9) are analyses over the op list.

The flush is a position in that list too, but UNCITED — 35.10 makes the flush the batching unit of
a sink fill and D37 is why, and neither says where a flush sits in an emission order. 41.5 governs
what a flush waits for, which is a third statement. If the op list is where a flush is located,
that is a requirement this plan owes a clause.

A FOURTH IS CONTESTED AND THIS PLAN DOES NOT DECIDE IT. The uniform reading is that the marker list
a document carries IS the op indices, which makes a mismatch "op *i* expected kind K" and localises
it to the enclosing block by construction (41.11). `renderer.md` takes the other arm: a marker per
BLOCK and none for a text or attribute slot, a row found by counting its known span from the block
anchor, on the grounds that it saves a comment node per interpolation on every row of every list.
Under that arm four of the five op kinds have no marker to mismatch against and the message is
"block *i*", not "op *i*". Both plans currently state their arm as settled and neither cites the
other. 41.10 is the clause and it is the one `renderer.md` already flags as needing amendment, so
it is decided there or in RULEBOOK, not here — and this section keeps no sentence about markers once
it is.

The IR is also what a test asserts against, and what an op-count ratio against the vanilla arm is
counted over.

### Sinks

Sink ids are allocated on the IR walk — static ids for static constructs, a range per block — so
the seed manifest and the sink table are both compile-time lists and the runtime only fills. The
filler script takes everything specific to a hole from the `<template>` beside it, which is what
lets one build-time hash cover every one of them. That the script is byte-identical is a
compiler invariant with a test: hash the emitted filler across every page, and assert one
distinct value.

## What TypeScript 7.1 changes

7.1 stabilises three APIs — Content Mapper, Emit, Language Service. Beta 2026-10-06, RC
2026-11-10, stable 2026-11-24. The root `package.json` carries `typescript: ^7.0.2`, which floats
into it; the specifiers are `unstable/*` today and may be renamed on stabilisation, so pin it.

The **Content Mapper API** is the supported way to make TypeScript understand a foreign file
format, and `.abide` is exactly its shape:

* A mapper is a child process TypeScript spawns, JSON-RPC over stdio, with `Initialize`,
  `OpenProject`, `Transform` and `CloseProject`. TypeScript sends every request.
* `Transform` returns the TypeScript text and a span mapping, in three kinds: **Verbatim** (same
  length and content), **Atom** (different text, same entity), **Alias** (virtual text
  substituted into a diagnostic's message).
* **Supplemental outputs**: one source file may contribute several TypeScript files that join the
  program with no import.
* Diagnostic directives, and per-span control over which language-service features apply.
* Mapper processes are deduplicated by package name and version; a mapper declaring
  `dynamicConfig` returns a stable `configIdentity` for caching.
* Mappers do NOT emit JavaScript. Checking and language service only.

What it does to this plan:

1. The virtual-FS smuggling goes away for `abide check` and `abide lsp`, and the projection
   becomes a protocol output. The process topology inverts — abide is the child — so the Bun fd
   problem does not exist on that path.
2. **Alias is a better arm than dropping.** `__read(count)` does not need suppressing; it needs
   mapping, so the diagnostic reads `count`. Suppression is the fallback for text standing for
   no spelling at all.
3. Supplemental outputs are the server program and the client program, declared.
4. The position-map machinery shrinks: abide produces the mapping, TypeScript consumes it.
5. `Transform` and the plan pass must be THE SAME CODE, mappers not emitting, or `check` and
   `build` drift. Which is the plan-answer-emit split again: the plan pass IS `Transform`.
6. A build being a function of the source and the answers gains a second reason — TypeScript
   keys its own mapper caching on `configIdentity`.

**The hedge, which costs nothing and is wanted anyway:** the plan pass returns the projection as
a VALUE — text, plus a span table in the Verbatim/Atom/Alias vocabulary — rather than inlining it
into whichever transport is in use. Today it feeds the virtual FS; in November it feeds a
`Transform` reply with no compiler change. Adopting the vocabulary now is the part that would
otherwise be retrofitted through every lowering.

Under 7.0.2 the transport is the ASYNC client. The sync client is spawn-only, so it cannot share
one checker between `dev`, `check` and `lsp`, and under Bun it needs the FIFO shim below.

## What this plan would land in the four documents

Clause numbers below are the next free ones AS OF 2026-09-10 — the rulebook ends at group 42, and
at 38.20, 32.26, 19.15 — and they moved once already because they were not: a plan sat here long
enough for `32.26` to be written as something else, and this ledger then read "ends at group 41"
long enough for the proposals to be written as 42.x against a live `42. The app object`. Re-check
them before landing any of this; nothing gates a citation in `docs/plans/`, so the collision that
matters is the one that RESOLVES.

DECISION numbers are NOT pre-allocated. The proposals below are `P1`…`P7` and take real `D`
numbers at landing, because the first draft of this plan reserved D86 through D92 and every one
of those seven was written in DECISIONS.md for something unrelated while the plan waited. A
number is stable once written and a plan is not the place to spend one.

### RULEBOOK, a new group

```markdown
# 43. Type-directed lowering

43.1 Every lowering a type decides MUST declare the answers it lowers to, one of them being the
answer for a type that does not resolve. See P2.

43.2 A lowering MUST take that answer where the type does not resolve, and MUST NOT refuse the
file. See P1.

43.3 An answer MUST be taken at the binding where a name is what the lowering reads, and at the
site otherwise. See P3.

43.4 A build MUST be a function of the source and the answers, and MUST NOT depend on the order
the files compiled in.

43.5 A name the compiler declares to ask an answer MUST NOT resolve in application source.

43.6 The projection a lowering takes its answers against MUST be the projection the build plans
from. See P7.
```

Three rows for the Terms table, the clauses being written over categories rather than over one
name each:

```markdown
| lowering | What a spelling in a `.abide` file compiles to. |
| answer | What a type resolves to at a site a lowering is decided by. |
| projection | The TypeScript a `.abide` file is checked as. |
```

### RULEBOOK, additions to Commands

```markdown
38.21 The diagnostics `abide check` reports MUST be the diagnostics `abide build` refuses on.
See P5.

38.22 A diagnostic whose span is text the compiler wrote MUST be reported against the spelling
that text stands for, and one standing for no spelling MUST be counted rather than reported.
See P4.

38.23 `abide check --strict` MUST report every lowering that took 43.2's answer.
```

### RULEBOOK, withdrawals

```markdown
19.13 *Withdrawn, superseded by 43.2 and 19.16.* It read "Where inference fails the compiler MUST
read rather than refuse the file, and the derived `Schema` MUST widen", which stated for one
lowering what 43.2 requires of every one.

19.16 A derived `Schema` MUST widen where 43.2's answer is taken.

32.17 *Withdrawn, superseded by 32.27.* It read "`{#for}` without a key over a stateful body MUST
warn in development", which gated a fact the build already has on a run-time mode.

32.27 `{#for}` without a key over a stateful body MUST warn at build.
```

### REGISTRY

The gate builds its id set from LIVE clauses, so a row citing a withdrawn number fails it. The
first two rows below are forced by the withdrawals, not optional.

| Row | Cell now | Cell after |
| --- | --- | --- |
| `Schema<T>` | `…, 19.11, 19.12, 19.13` | `…, 19.11, 19.12, 19.16, 43.2` |
| `{#for item, index of list by key}` | `32.16, 32.17` | `32.16, 32.27` |
| `abide check [dir…]` | `38.3` | `38.3, 38.22, 38.23, 43.5` |
| `abide build` | `38.5` | `38.5, 38.21, 43.4, 43.6` |
| `foo` in an operand, text, attribute or value-typed argument | `31.1, 31.2, 31.10, 31.15` | `…, 43.3` |
| `props` | `33.1 … 33.15` | `…, 43.1, 43.2` |

The `abide check` command cell gains its flag: `abide check [dir…] [--strict]`.

### The rest of the withdrawal's blast radius

REGISTRY is not the only gated document citing 19.13, and the two below are gated for EXISTENCE —
so landing the withdrawal without them fails the gate rather than merely going stale. `grep -rn
'19\.13' docs/ CLAUDE.md` is the whole check, and it returns six sites, of which the REGISTRY row
above is one.

| Site | Reads | Becomes |
| --- | --- | --- |
| `docs/BRAND.md:98` | "19.13 — where inference cannot reach, the schema WIDENS rather than the file being refused" | 19.16, same sentence |
| `CLAUDE.md:66-67` | "RULEBOOK 19.13 is the rule and D22 is why it widens rather than refusing" | 19.16 is the rule, and P1 is why — see below, D22 is REVERSED by this plan, so the second half of that sentence dies with the clause |
| `docs/plans/REACTIVE.md:332` | "19.13 and D22 govern the widening, and the adapter shape is not settled" | 19.16 and P1; ungated, so nothing but this row will catch it |
| `docs/plans/COMPILER.md:39` | this file's own artifact table | 19.16 |

32.17 has one further site, `docs/plans/COMPILER.md:56` — the static-refusals list — already
written as 32.27 above.

### DECISIONS

* **P1.** A lowering with no answer widens, and the widening is reported. Refuses an exception
  for schema inference alone, and the silence that came with it. Decides 43.2, 19.16, 38.23.
  D22 is marked reversed in place by it: the widening half survives, the silent half does not,
  and D22 currently decides a clause the withdrawal takes off the live list.
* **P2.** The compiler asks the type system for answers, not for types. Refuses reading the type
  at a site and deciding the lowering from its shape. Decides 43.1, 43.5. Assumes 19.11, 31.14,
  33.10.
* **P3.** The answer is taken at the binding. Refuses an answer per use site. Decides 43.3.
  Assumes 31.1, 31.3.
* **P4.** A diagnostic in text the compiler wrote is mapped or counted, never moved. Refuses
  reporting it at the file's first line. Decides 38.22. Assumes 38.3.
* **P5.** One front end for `check` and for `build`. Refuses a syntactic-only `abide check`
  beside the build's full one. Decides 38.21.
* **P6.** An unkeyed `{#for}` over a stateful body warns at build. Refuses a development-only
  warning. Decides 32.27.
* **P7.** One projection, transformed for the checker and planned from by the build. Refuses a
  transform written for the checker beside the one the build walks. Decides 43.6.

## What is not decided

* **The cost 41.7 does not price.** Re-executed setup means the client bundle carries `<script>`
  work only the server needed. 16.31 catches a `#server` import and nothing catches the rest. No
  wording tried so far either forbids something legitimate or is enforceable, so it waits for a
  measured bundle to argue over.
* **The answer set per rule.** Six rules, and each owes its declared answers and its widening
  arm. The nine probed above are a sketch of three of them.
* **The IR op set.** Named here as a shape, not enumerated.
* **Where the `.abide` parse lives.** The scanner is `typescript/unstable/ast`; the expression
  grammar inside a template is abide's own, and how much of TypeScript's expression grammar it
  has to know is unsettled.

## Gates

A gate is verified by reverting the fix and watching it fail, and the number it reports with the
fix out is what the gate is worth.

| What | Gate | The break to inject, and what it reports |
| --- | --- | --- |
| Every lowering | The answer table for a fixture, asserted whole. One test per rule. | Force one rule's answer to its widening arm: that row's string moves |
| The emit | Golden IR for a fixture answer table, with no checker in the test. | Golden-from-output is green by construction — the golden is committed from a REVIEWED run and the break is a hand-edited op: 1 op differs |
| 43.2 | A fixture whose type cannot resolve builds, and reports under `--strict`. | Refuse instead of widening: build fails, 0 reports → 1 refusal |
| 43.4 | The same sources compiled in two orders produce byte-identical output. | Green on first run unless order-dependence is injected — seed the hole ids off visit order rather than span order: 0 differing bytes → the whole marker block |
| 43.5 | A completion request at a template position offers no name the compiler declared. | Drop the declared-name filter: 0 leaked names → 9 (one per question) |
| 38.21 | The diagnostic sets of `check` and `build` over the dogfood app are equal. | Give `check` the lowering pass and `build` the full one: 0 differing diagnostics → every lowered expression |
| 38.22 | A type error inside a lowered expression reports at the author's span. | Report the projection span: the reported line moves off the `.abide` line |
| The filler | One distinct hash across every page the dogfood app serves. | Hash the source alone, not source+answers: distinct → 1 collision per shared template |
| The wave | One checker call per file per wave, counted — not a query per hole. | Ask at the site: 1 call → 400 |
| The cache | An upstream edit moving no answer produces a cache hit, counted. | Key on the import graph instead of the answer table: 1 hit → 0 |

The last two are the ones that fail silently: the output stays right while the work goes wrong.
Rows 2 and 4 are the two that would be green on their first run, which is why each names the break
rather than the assertion — a gate written after the change and never seen red has not been shown
to test anything.

## Sequence

1. **Parse to a projection.** The plan tree, and the projection as a value — text plus a span
   table in the Verbatim/Atom/Alias vocabulary. Gate: the span table round-trips every author
   span to itself.
2. **The answer client.** One batched wave over the async client, the answer table as a value,
   the widening arm per rule. Gate: the answer-table tests, and the one-call-per-wave count.
3. **The IR and the server backend.** Enough to render a static page, then sinks. Gate: golden
   IR, and a served page in the dogfood app.
4. **The client backend.** Markers, hydration, mismatch containment. Gate: the e2e projects.
5. **The project passes.** Route table, generated wrappers, seam refusals, derived schemas.
6. **`check` and `lsp`.** One front end, and then the mapper when 7.1 lands.

The vanilla arm comes first at every step that makes a performance claim, and the share the layer
holds is written down before the layer is changed.

## Reproducing the numbers

All three probes run against a fixture project with a `tsconfig.json` and one 305-line file
declaring 300 `const` bindings. Paths must be real — `/tmp` is a symlink on macOS and the server
refuses it.

**Batched against unbatched.** Collect the 300 declaration positions, call
`checker.getTypeAtPosition(file, position)` in a loop, then `checker.getTypeAtPosition(file,
positions)` once, and divide each by 300. Run it twice: one run cannot tell a small difference
from none.

**The answers.** Declare the conditional types and one `declare const qN` per question, then
batch the nine positions and read `type.isStringLiteralType()` and `type.value`.

**The sync client under Bun.** The shipped channel reads `stdout._handle.fd`, which Bun does not
expose. Two FIFOs held open `O_RDWR` — the shape their own win32 branch already uses — replace
it:

```ts
const dir = mkdtempSync('/tmp/abide-sync-')
const toChild = `${dir}/in`, fromChild = `${dir}/out`
Bun.spawnSync(['mkfifo', toChild, fromChild])
const writeFd = openSync(toChild, 'r+')
const readFd = openSync(fromChild, 'r+')
const proc = Bun.spawn([exe, ...args], {
    stdio: [openSync(toChild, 'r'), openSync(fromChild, 'w'), 'inherit'],
})
```

Teardown needs care: the parent's own `O_RDWR` handles keep the pipe open, so a probe that does
not exit explicitly hangs rather than ending.
