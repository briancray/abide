# ADR 0029 — the check lane keeps its own walk

**Status:** accepted (a rejection, recorded so it is not re-proposed).

## Context

An architecture review looked at the three compiler lanes and found what looked like a missing seam.
`buildPlan` (`ui/internal/templatePlan.ts`) has exactly two production callers — `emit.ts:126`, which
feeds `emitServer` + `emitClient`, and `validateTemplate.ts:37`, the legality gate. `emitCheck.ts`
(888 lines) is not one of them: it imports `BindingAnalysis` as a **type only** and walks the `Root` AST
itself.

The evidence for that being a defect was real and is worth restating, because it is what will prompt the
next reviewer:

- `laneAgreement.test.ts:1-10` records four constructs that "went green in the editor and hard-threw on
  build", and says plainly that "no test could catch that, because no test ran a source through both
  lanes."
- `emitCheck.ts:532` carries a comment *asserting another module's behaviour* — "UNREACHABLE:
  `templatePlan` rejects `class:`/`style:` on a component".
- Two more drift bugs are on record: `props as p` silently opening a component's type with no diagnostic
  (fixed by sharing `BindingAnalysis`), and the string-scanning copies that "drift ASYMMETRICALLY BY LANE
  while `abide check` stays green over the broken one" (fixed by giving `scanText.ts` one owner).

The proposal was: make `emitCheck` a third emitter over `TemplatePlan`, so a construct is described once
and every lane sees it. `CONTEXT.md`'s "they keep separate *lowerings* on purpose" was read as an accepted
cost.

## Decision

**Rejected.** `TemplatePlan` is not a lane-neutral IR that the check lane declines to use. It is the build
lane's *lowering*, and every field of it is a DOM or hydration commitment:

| field | what it commits to |
| --- | --- |
| `skeletonClient` / `ClientPlan.skeleton` | an HTML skeleton string to clone at mount |
| `DynamicSlot.path` | a child-index path into that skeleton |
| `prefixLen` | a UTF-16 offset for splitting a parser-merged text node during hydration |
| `serverChunks` | emitted server-code strings |
| `component.ref` | the **rewritten** tag expression (`$scope.Row`) |
| `hasComponent` / `hasScript` | whether an item needs its own hydration-seed bucket |
| `siteId` | a per-module component site id |

The last one is decisive. `emitCheck.ts:9` states its own governing invariant: *"THE ONE INVARIANT (mapping
depends on it): user code is copied VERBATIM into the generated module."* That verbatim copy is what makes
type annotations inside template expressions check for free, and it is what the bidirectional `Segment[]`
map — and therefore every LSP position, hover, definition and reference — is built on. `TemplatePlan`
carries expressions that have already been rewritten to `$scope.X` form; `TODO.md` #11 records that this
rewritten intermediate is deliberately "not type-valid but HARMLESS" *because* `emitCheck` is a separate
verbatim path. Feeding the plan to the check lane would destroy the one property the check lane exists to
have.

So the two lanes do not share a lowering because a lowering is not a shareable thing here: one lowers to a
DOM mutation plan, the other to type-only TS whose bytes must match the author's. `CONTEXT.md`'s wording is
a constraint, not a concession.

## What the evidence was actually about

The three recorded bugs were **not** lowering drift. They were about facts upstream of lowering, and each
already has exactly one owner:

| the fact | its owner |
| --- | --- |
| which templates are LEGAL | `validateTemplate`, which asks `buildPlan` — the seam exists, and `laneAgreement.test.ts` guards it as a harness rather than a case list |
| what a `<script>` BINDS | `analyzeBindings`'s `BindingAnalysis`, consumed by both lanes |
| character-level scanning | `scanText.ts` |
| how much room a bracketed slot takes | `ui/internal/SLOT_FOOTPRINT.ts` — a `Record<SlotKind, …>`, so a new slot kind does not compile until it declares its footprint |
| where a node's CHILDREN are, and what it BINDS | `ui/internal/templateChildren.ts` — `CHILD_LISTS`/`BINDING_SITES`, two `Record`s over `TemplateNode['type']` |

The last two rows were added by a later session, which is the table working as intended: both are
STRUCTURAL facts about the AST rather than lowerings, so the "in scope" clause below applied and each
got an owner. Both had been stated in three or four modules apiece, and all of the copies FAILED OPEN —
no `default` arm, so a new node type was silently skipped rather than loudly unhandled. The `Record`
shape is what converts that into a compile error.

That is the pattern to keep: the drift surface has been given owners one fact at a time, and what remains
separate is the part that must be.

`emitCheck.ts:532` stays as it is. A comment naming the single owner of a cross-module invariant is what
`docs/SIMPLIFICATION.md` §6 asks for ("find the comment explaining it. If there is none, that is the first
thing to add"), not a second statement of it — the rule itself is written once, at `templatePlan.ts:416`,
and `componentAttrLanes.test.ts:82-83` asserts both lanes reject it.

## Consequences

- A future review that finds `buildPlan`'s two callers and proposes a third should read this first. The
  finding is well-evidenced and the conclusion is still no.
- If a *legality*, *binding* or *structural* fact is ever found stated twice, that is in scope and this
  ADR does not cover it — give it an owner, as the rows above were given one, and add a row.
- The residual cost is accepted: the two lanes must agree on what each construct MEANS, and that agreement
  is enforced by enumeration (`componentAttrLanes.test.ts`). An enumeration is a weaker guard than a shared
  structure, and here it is the strongest one available.
