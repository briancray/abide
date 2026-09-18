// The client runtime — what a compiled `.abide` bundle imports through `abide/runtime`.
// Every module reached from here is in the client's static closure, so an export added here is
// paid for on every page (CLAUDE.md, "seams and imports"). The list IS the budget.
//
// The shared walk a region's bindings start from, the text node for a binding, the element for
// a listener, the write, the stringify a run's parts go through — and the four names a DYNAMIC
// region needs, which are the only ones that put anything in the document. Nothing that finds a node by something added to the
// document, because a compiler may not invent structure an author's CSS or queries can see.

export { escapeless } from './escapeless.ts'
export { childAt, elementAt, textAt } from './nodeAt.ts'
export { REGION_CLOSE, REGION_OPEN } from './REGION.ts'
export { type Row, reconcile, rowsIn } from './reconcile.ts'
export {
    afterRegion,
    fillRegion,
    insideRegion,
    type Region,
    regionAt,
} from './regionAt.ts'
export { setText } from './setText.ts'
