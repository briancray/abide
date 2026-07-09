# ADR-0023 discovery findings — does the shadow `mappings` resolve a `<script>`-region seed?

**Answer: YES.** The shadow `mappings` cover the `<script>` region with usable source→shadow
offsets, and `checker.getTypeAtLocation(node)` on the mapped node yields the seed's real
checker type. The load-bearing prerequisite (ADR-0023 D2 / open question) holds. **The ADR
ships as designed — no prior shadow-mapping extension is needed.**

## Method

A throwaway probe (`packages/abide/scratch-adr0023-probe.ts`, deleted after discovery) built
the warm shadow program for a real on-disk `.abide` with five `state.computed(SEED)`
declarations of different seed kinds in the leading `<script>`, then, for each seed:

1. Reproduced `analyzeComponent`'s script-body arithmetic — `scriptStart = source.indexOf('>',
   matchIndex) + 1` (just past the opening `<script …>`, identical to `compileShadow`'s
   `scriptStart`) plus the trimmed body's leading-whitespace delta → `scriptContentBase`.
2. Parsed the trimmed body the way `desugarSignals` does, took each seed `ts.Expression`, and
   computed its absolute source offset `scriptContentBase + seed.getStart()`.
3. Called `sourceToShadowOffset(mappings, absLoc)` → `nodeAtShadowOffset(shadowFile, offset,
   seedText.length)` → `classifyInterpolationType(checker.getTypeAtLocation(node), …)` — the
   exact interpolation-classifier pipeline, unchanged.

## Result (both shadow shapes)

The shadow projects a *recognized* reactive `state.computed(SEED)` to `const NAME = (SEED)();`
(via `scopeLineFor`), and an *unrecognized*-callee `computed(SEED)` verbatim. **Both** map the
`SEED` sub-expression back to source and resolve its type:

| seed | shadow emission | resolved kind |
|---|---|---|
| `state.computed(getStream())`         | `(getStream())();`         | `asyncIterable` ✓ |
| `state.computed(add(1, 2))`           | `(add(1, 2))();`           | `sync` ✓ |
| `state.computed(getPromise())`        | `(getPromise())();`        | `promise` ✓ |
| `state.computed(obj.stream)`          | `(obj.stream)();`          | `asyncIterable` ✓ |
| `state.computed(cond ? sA : sB)`      | `(cond ? sA : sB)();`      | `asyncIterable` ✓ |

Every `sourceSlice === seedText` matched (offset arithmetic is correct), and every node text
was the exact seed.

## Offset semantics / why it works

- The seed is emitted **wrapped in parens** — `(SEED)` — exactly like a template interpolation,
  so `nodeAtShadowOffset`'s exact-span finder locates the `SEED` node **as-is, with no
  variant**. The `()` invocation the projection appends (treating the seed as a thunk) is a
  shadow-local *call*-error on the enclosing expression, but the checker resolves the inner
  `SEED` node's type independently, so `getTypeAtLocation(SEED)` returns the seed's own type
  (the stream / promise / number), not the invoked result.
- The `mappings` sourceStart for a projected seed is `scriptStart + fn.getStart(shadowBody)`
  where `shadowBody` is the **untrimmed** `<script>` body. `desugarSignals` parses the
  **trimmed** body, so its seed `getStart()` is short by the leading-whitespace length —
  re-added by folding that delta into `scriptContentBase`. The two coordinate systems align
  exactly.

## Consequence for the implementation

The interpolation classifier and the seed classifier share the identical resolve pipeline
(`sourceToShadowOffset` → `nodeAtShadowOffset` → `classifyInterpolationType`) over the **same
warm shadow program** — no second program build, no `nodeAtShadowOffset` variant. The **only**
new mechanism is the `scriptContentBase` offset (threaded `analyzeComponent` →
`lowerScript` → `desugarSignals`) and a seed-classifier closure that returns
`InterpolationKind | undefined` — where `undefined` (not `'sync'`) marks a resolution failure,
so the dispatch fails **open to `isBareCallComputed`** rather than mis-routing a failed seed to
the lazy `derive` slot. This is the one contract difference from `InterpolationClassifier`
(which collapses failure to `'sync'`, correct for interpolations where sync == today's plain
bind, but wrong for seeds where a failure must degrade to the syntax heuristic).

STATUS: discovery viable → proceeding to D1 + D2.
