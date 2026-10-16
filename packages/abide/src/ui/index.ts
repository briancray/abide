// The client runtime — what a compiled `.abide` bundle imports through `@abide/abide/runtime`.
// Every module reached from here is in the client's static closure, so an export added here is
// paid for on every page (CLAUDE.md, "seams and imports"). The list IS the budget.
//
// The steps a mount's walk takes and the checks a binding makes on what it found (`adoptWalk.ts`),
// the write, the stringify a run's parts go through — and
// what a DYNAMIC region needs: what WRITES into one (`fillRegion` for an arm, `fillEmpty` for a region
// that fills itself,
// `listAt` and `updateList` for a `{#for}` — which reconciles an array and appends an async
// subject, 32.15 — and `replaceRow` for a row), what a hydration mismatch is answered with
// (`warnMismatch`, 41.10), what every region's bindings are stopped through (`Scope`), what a
// row's markup is parsed with (`markupNodes`)
// and the anchors they are all counted from. 32.3's writes are THREE names rather than one
// (`setAttribute`, `setStyleProperty`, `setClass`) for one reason said once: every `style:prop`
// and every `class:name` on an element is merged by the server into the single `style` or `class`
// attribute beside the author's own, so neither of those two attributes can be written back whole
// — the CSSOM and `classList` are what touch the one declaration or the one token a binding owns.
// A list is reached through `listAt` and `updateList` alone, so its rows' shape is no caller's.
// Nothing that finds a node by something added to the document, because a compiler may not invent
// structure an author's CSS or queries can see.

// THE ROUTER IS NOT HERE. It has its own entry (`ui/routing.ts`, `@abide/abide/routing`), which is what
// keeps the list below the budget this header calls it — a subsystem only the emitted route table
// reaches does not belong on what every compiled module resolves through.

export { REGION_CLOSE, REGION_OPEN } from '#shared/ANCHORS.ts'
export { oneStyleValue } from '#shared/escapeText.ts'
export { isRaw } from '#shared/Raw.ts'
// 12.4 — the watches a component's setup opens, collected for the scope its markup makes.
export { collectWatches } from '#shared/reactive/watch.ts'
export { ArmRegion, ChosenRegion } from './ArmRegion.ts'
// 41.10's adopt half of a walk the compiler emits twice from one traversal — see `adoptWalk.ts`.
export {
    elementHere,
    regionFound,
    regionHere,
    runHere,
    textHere,
} from './adoptWalk.ts'
// 39.6 — a module mounted into an empty region applies its own head, from inside its instance
// (`emitClient`); only a module that carries its own markup and a `<head>` imports it.
export { applyHead } from './applyHead.ts'
export { bindElement } from './bindElement.ts'
export { bindProperty } from './bindProperty.ts'
export { bindSpread } from './bindSpread.ts'
export { escapeless } from './escapeless.ts'
// 39.1 — a component's `<head>`, joined to the routed level mounting it.
export { contributeHead } from './Level.ts'
export { listAt, updateList } from './List.ts'
export { warnMismatch } from './Mismatch.ts'
export { markupNodes } from './parseMarkup.ts'
export {
    fillEmpty,
    fillRegion,
    isEmptyRegion,
    type Region,
} from './regions.ts'
export { rowKeyOf } from './rowKeyOf.ts'
export { itemOf, noUpdate, replaceRow, rowCell } from './rows.ts'
export { EMPTY_SCOPE, Scope } from './Scope.ts'
export { setAttribute } from './setAttribute.ts'
export { setClass } from './setClass.ts'
export { setMarkup } from './setMarkup.ts'
export { setStyleProperty } from './setStyleProperty.ts'
export { setText } from './setText.ts'
export { TryRegion } from './TryRegion.ts'
