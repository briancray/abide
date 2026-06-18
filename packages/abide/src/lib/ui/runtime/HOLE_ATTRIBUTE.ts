/*
The marker attribute the client back-end stamps on each hole element in a skeleton
string — an element carrying reactive attributes/listeners/binds whose live node the
build must wire up. Its value is the hole's index, so attach code addresses holes by
number regardless of document order. `skeleton` records each marked node's path,
strips the attribute, and returns the holes indexed by it. One source of truth so the
compiler's emit and the runtime's read can't drift.
*/
export const HOLE_ATTRIBUTE = 'data-abide-hole'
