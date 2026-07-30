import type { SlotKind } from './templatePlan.ts'

// HOW MUCH ROOM A SLOT KIND TAKES IN ITS PARENT'S CHILD LIST, and where its anchors are.
//
// `BLOCK_ANCHOR.ts` and `HTML_ANCHOR.ts` own the anchor STRINGS, and their headers say why. Nobody owned
// the ARITHMETIC those strings imply, which is one commitment with four consequences:
//
//   1. a bracketed slot occupies TWO child positions (its open anchor and its close), a leaf ONE, and an
//      attribute-ish slot NONE — it attaches to an element that already has a position;
//   2. `DynamicSlot.path` names the CLOSE anchor, so the open sits at `path[last] - 1`;
//   3. an adjacent static text run must therefore not advance the child index a second time;
//   4. a bracketed slot's close is located from its open by a FINDER, and which finder is a property of
//      the kind — `html` brackets with its own `<!--[h-->` pair carrying a token, so it is matched by
//      reading that token rather than by the depth-counting walk every other block uses.
//
// That was spelled in four modules: `templatePlan` restated the literal `2` at eight sites,
// `emitClient` classified kinds through two `Set<string>`s plus a hand-written `=== 'html'` and restated
// `index - 1` twice, and `hydrateCursor` implements the two finders `emitClient` names as strings.
//
// THE FAILURE MODE IS SILENT, which is why this is a table and not a convention. Add an 18th `SlotKind`
// that brackets its region and forget `BLOCK_KINDS`: `emitClient` classified it as `'element'`, the
// level consumed one child position instead of two, the hydrate cursor desynced from there on, and the
// runtime quietly fell back to a fresh mount — correct-looking output, no error, the whole point of
// hydration gone. `planParity.test.ts` can only catch that if a fixture happens to exercise the new
// kind. A `Record<SlotKind, …>` catches it at the compiler: a missing key is a type error at the one
// place that enumerates them.
//
// Deliberately NOT derived from the slot's own data. "How many positions" is a property of the KIND, not
// of an instance — an `{#if}` with no branches still brackets — so a table keyed by kind is the whole
// truth and a runtime inspection would only be able to guess it.

// A bracketed slot's close anchor is found from its open by one of these. The names are EMITTED into
// generated client code as `$rt.<name>`, so they are the runtime's exported identifiers, not labels.
export type CloseFinder = 'findBlockClose' | 'findHtmlClose'

export type SlotFootprint =
    // Attaches to an element that already holds a child position of its own — attributes, listeners,
    // spreads, and the two slots that emit no node at all (`componentDef`, `script`).
    | { positions: 0 }
    // One `<!---->` value position: a scalar text node and its anchor.
    | { positions: 1 }
    // A paired open/close anchor around a region the server painted.
    | { positions: 2; closeFinder: CloseFinder }

// EVERY slot kind, exhaustively. The `Record` is the enforcement — a new `SlotKind` does not compile
// until it says how much room it takes.
export const SLOT_FOOTPRINT: Record<SlotKind, SlotFootprint> = {
    // Leaves.
    interpolation: { positions: 1 },
    await: { positions: 1 },

    // Bracketed by the shared `<!--[-->`/`<!--]-->` pair, whose close is found by depth-counting (nested
    // blocks use the same two comments, so the walk has to balance them).
    if: { positions: 2, closeFinder: 'findBlockClose' },
    for: { positions: 2, closeFinder: 'findBlockClose' },
    switch: { positions: 2, closeFinder: 'findBlockClose' },
    try: { positions: 2, closeFinder: 'findBlockClose' },
    awaitBlock: { positions: 2, closeFinder: 'findBlockClose' },
    component: { positions: 2, closeFinder: 'findBlockClose' },

    // Bracketed by its OWN `<!--[h-->`/`<!--]h-->` pair carrying a token, because the content between
    // them is raw author HTML that may itself contain anything a depth count would miscount. Its close
    // is matched by reading the token off the open — see `serverRuntime.renderHtml`.
    html: { positions: 2, closeFinder: 'findHtmlClose' },

    // Attribute-ish: these modify an element, they do not occupy a position beside it.
    attr: { positions: 0 },
    class: { positions: 0 },
    style: { positions: 0 },
    bind: { positions: 0 },
    event: { positions: 0 },
    spread: { positions: 0 },

    // Emit no node: a component definition is a builder hoisted into setup, a `<script>` IS setup.
    componentDef: { positions: 0 },
    script: { positions: 0 },
}

// How many child positions a bracketed slot occupies. Named so `templatePlan`'s eight `childIndex += 2`
// sites say WHY they advance by two rather than restating the number.
export const BRACKETED_POSITIONS = 2

// The close finder for a bracketed kind, or undefined for one that is not bracketed. Doubles as the
// "is this bracketed?" test, so a caller asks once and gets the answer it needs rather than testing the
// kind and then looking the finder up separately.
export function closeFinderFor(kind: SlotKind): CloseFinder | undefined {
    const footprint = SLOT_FOOTPRINT[kind]
    return footprint.positions === 2 ? footprint.closeFinder : undefined
}

// Where a slot's OPEN anchor sits, given the child index its `path` names. `path` names the CLOSE, so a
// bracketed slot opens one position earlier and everything else opens where it sits. Consequence (2)
// above, written once.
export function openIndexFor(kind: SlotKind, index: number): number {
    return index - (SLOT_FOOTPRINT[kind].positions === 2 ? 1 : 0)
}
