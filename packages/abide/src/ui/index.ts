// The client runtime — what a compiled `.abide` bundle imports through `abide/runtime`.
// Every module reached from here is in the client's static closure, so an export added here is
// paid for on every page (CLAUDE.md, "seams and imports"). The list IS the budget.
//
// Four names: find the slots, find the listener elements, write a slot, bind an event. Template
// instantiation, keyed reconcile and event delegation are not here yet.

export { handlers } from './handlers.ts'
export { ELEMENT_ATTRIBUTE, SLOT_CLOSE, SLOT_OPEN } from './MARKERS.ts'
export { setText } from './setText.ts'
export { slots } from './slots.ts'
