// The client runtime — what a compiled `.abide` bundle imports through `@abide/abide/runtime`.
// Every module reached from here is in the client's static closure, so an export added here is
// paid for on every page (CLAUDE.md, "seams and imports"). The list IS the budget.
//
// 32.3's writes are THREE names rather than one (`setAttribute`, `setStyleProperty`, `setClass`)
// for one reason said once: every `style:prop` and every `class:name` on an element is merged by
// the server into the single `style` or `class` attribute beside the author's own, so neither of
// those two attributes can be written back whole — the CSSOM and `classList` are what touch the one declaration or the one token a binding owns.
// A `class={expr}` or `style={expr}` beside its directives is the same answer once more
// (`setClassGroup`, `setStyleGroup`, 32.71): the group writes what it owns, and nothing else.
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
export { bindElement } from './bindElement.ts'
export { bindFiles } from './bindFiles.ts'
export { bindGroup } from './bindGroup.ts'
export { bindProperty } from './bindProperty.ts'
export { bindSize } from './bindSize.ts'
export { bindSpread } from './bindSpread.ts'
export { bindVisible } from './bindVisible.ts'
export { escapeless } from './escapeless.ts'
// 32.23 — an invocation whose `{...expr}` has not landed, made once it has.
export { invokeLanded } from './invokeLanded.ts'
// 39.1 — a component's `<head>`, joined to the routed level mounting it.
export { contributeHead } from './Level.ts'
export { listAt, updateList } from './List.ts'
export { warnMismatch } from './Mismatch.ts'
export { markupNodes, namespaceUnder } from './parseMarkup.ts'
export { fillEmpty, fillRegion, isEmptyRegion, type Region } from './regions.ts'
export { rowKeyOf } from './rowKeyOf.ts'
export { itemOf, noUpdate, replaceRow, rowCell } from './rows.ts'
export { EMPTY_SCOPE, Scope } from './Scope.ts'
export { addAttribute, setAttribute } from './setAttribute.ts'
export { setClass } from './setClass.ts'
export { setClassGroup } from './setClassGroup.ts'
export { setMarkup } from './setMarkup.ts'
export { setStyleGroup } from './setStyleGroup.ts'
export { setStyleProperty } from './setStyleProperty.ts'
export { setText } from './setText.ts'
export { TryRegion } from './TryRegion.ts'
