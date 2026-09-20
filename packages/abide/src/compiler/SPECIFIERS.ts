// What EMITTED code resolves abide through. A leaf, and the contract between the compiler and an
// app's module graph: emitted code is the APP's, so it reaches for the public specifiers that
// `packages/abide` itself is forbidden to (CLAUDE.md, "seams and imports"). Holding them here is
// also what keeps that ban checkable: an import specifier written into a template literal reads
// to a grep exactly like an import statement, so holding all four here is the difference between
// a check that works and one with an exception in it.
//
// FOUR, BECAUSE THE ROUTER IS NOT PART OF WHAT EVERY PAGE IMPORTS. Only the emitted route table
// names it, and an entry of its own is what keeps it off the runtime barrel every compiled module
// resolves through. `ui/routing.ts` records what that is and is not worth.
export const SHARED_SPECIFIER = 'abide'
export const SERVER_SPECIFIER = 'abide/server'
export const RUNTIME_SPECIFIER = 'abide/runtime'
export const ROUTING_SPECIFIER = 'abide/routing'
