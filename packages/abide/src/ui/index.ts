// The client runtime — what a compiled `.abide` bundle imports through `abide/runtime`.
// Every module reached from here is in the client's static closure, so an export added here is
// paid for on every page (CLAUDE.md, "seams and imports"). The list IS the budget.
//
// Five names: find a region's slots, take one by its number, find its listener elements, write a
// slot. Template instantiation, keyed reconcile and event delegation are not here yet.

export { handlers } from './handlers.ts'
export { ELEMENT_ATTRIBUTE, SLOT_CLOSE, SLOT_OPEN } from './MARKERS.ts'
export { setText } from './setText.ts'
export { slotAt } from './slotAt.ts'
export { slots } from './slots.ts'
