// The client runtime — what a compiled `.abide` bundle imports through `abide/runtime`.
// Every module reached from here is in the client's static closure, so an export added here is
// paid for on every page (CLAUDE.md, "seams and imports"). The list IS the budget.
//
// Five names: the shared walk a region's bindings start from, the text node for a binding, the
// element for a listener, the write, and the stringify a text run's parts go through. Nothing that finds a node by something added to the
// document, because a compiler may not invent structure an author's CSS or queries can see.

export { escapeless } from './escapeless.ts'
export { childAt, elementAt, textAt } from './nodeAt.ts'
export { setText } from './setText.ts'
