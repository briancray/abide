// The client runtime — what a compiled `.abide` bundle imports through `abide/runtime`.
// Every module reached from here is in the client's static closure, so an export added here is
// paid for on every page (CLAUDE.md, "seams and imports"). The list IS the budget.
//
// The steps a mount's walk takes and the checks a binding makes on what it found (`adoptNode.ts`),
// the write, the stringify a run's parts go through — and
// what a DYNAMIC region needs: what WRITES into one (`fillRegion` for an arm,
// `listAt` and `updateList` for a `{#for}` — which reconciles an array and appends an async
// subject, 32.15 — and `replaceRow` for a row), what a hydration mismatch is answered with
// (`warnMismatch`, 41.10), what every region's bindings are stopped through (`Scope`), what a
// row's markup is parsed with (`markupNodes`)
// and the anchors they are all counted from. 32.3's writes are THREE names rather than one
// (`setAttribute`, `setStyleProperty`, `setClass`) for one reason said once: every `style:prop`
// and every `class:name` on an element is merged by the server into the single `style` or `class`
// attribute beside the author's own, so neither of those two attributes can be written back whole
// — the CSSOM and `classList` are what touch the one declaration or the one token a binding owns.
// `List` and `reconcile` are here for the
// harness's list bench, which prices the reconcile alone. Nothing that
// finds a node by something added to the document, because a compiler may not invent structure an
// author's CSS or queries can see.

// THE ROUTER IS NOT HERE. It has its own entry (`ui/routing.ts`, `abide/routing`), which is what
// keeps the list below the budget this header calls it — a subsystem only the emitted route table
// reaches does not belong on what every compiled module resolves through.

export { oneStyleValue } from '#shared/escapeText.ts'
export { isRaw } from '#shared/Raw.ts'
// 14.8 — an `{#if}` arm's branch-local `<script>`, set up outside the watch that swaps it in.
export { untracked } from '#shared/reactive/tracking.ts'
// 41.10's adopt half of a walk the compiler emits twice from one traversal — see `adoptNode.ts`.
export {
    elementHere,
    regionFound,
    regionHere,
    runHere,
    textHere,
} from './adoptNode.ts'
// 39.6 — a module mounted into an empty region applies its own head, from inside its instance
// (`emitClient`); only a module that carries its own markup and a `<head>` imports it.
export { applyHead, liveHead } from './applyHead.ts'
export { bindElement } from './bindElement.ts'
export { bindProperty } from './bindProperty.ts'
export { bindSpread } from './bindSpread.ts'
export { escapeless } from './escapeless.ts'
export { List, listAt, updateList } from './List.ts'
export { warnMismatch } from './Mismatch.ts'
export { markupNodes } from './parseMarkup.ts'
export { REGION_CLOSE, REGION_OPEN } from './REGION.ts'
export { type Row, reconcile, replaceRow } from './reconcile.ts'
export { fillRegion, isEmptyRegion, type Region } from './regions.ts'
export { rowKeyOf } from './rowKeyOf.ts'
export { EMPTY_SCOPE, Scope } from './Scope.ts'
export { setAttribute } from './setAttribute.ts'
export { setClass } from './setClass.ts'
export { setMarkup } from './setMarkup.ts'
export { setStyleProperty } from './setStyleProperty.ts'
export { setText } from './setText.ts'
export { inBoundary, TryBoundary } from './TryBoundary.ts'
