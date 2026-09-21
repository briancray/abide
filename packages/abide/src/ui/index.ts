// The client runtime — what a compiled `.abide` bundle imports through `abide/runtime`.
// Every module reached from here is in the client's static closure, so an export added here is
// paid for on every page (CLAUDE.md, "seams and imports"). The list IS the budget.
//
// The shared walk a region's bindings start from, the text node for a binding, the element for
// a listener, the write, the stringify a run's parts go through — and what a DYNAMIC region
// needs: the one that ADDRESSES one (`regionAt`; the rest of the addressing is one walk over a
// path, whatever kind of root it starts from), what WRITES into one (`fillRegion` for an arm,
// `listAt` and `updateList` for a `{#for}` — which reconciles an array and appends an async
// subject, 32.16 — and `replaceNodes` for a row), what a hydration mismatch is answered with
// (`warnMismatch`, 41.11), what every region's bindings are stopped through (`Scope`), what a
// row's markup is parsed with (`markupNodes`)
// and the anchors they are all counted from. 32.4's writes are THREE names rather than one
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

export { escapeless } from './escapeless.ts'
export { List, listAt, updateList } from './List.ts'
export { warnMismatch } from './Mismatch.ts'
export { childAt, elementAt, textAt } from './nodeAt.ts'
export { markupNodes } from './parseMarkup.ts'
export { REGION_CLOSE, REGION_OPEN } from './REGION.ts'
export { type Row, reconcile, replaceNodes } from './reconcile.ts'
export {
    fillRegion,
    isEmptyRegion,
    type Region,
    type Root,
    regionAt,
} from './regionAt.ts'
export { Scope } from './Scope.ts'
export { setAttribute } from './setAttribute.ts'
export { setClass } from './setClass.ts'
export { setStyleProperty } from './setStyleProperty.ts'
export { setText } from './setText.ts'
