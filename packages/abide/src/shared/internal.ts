// The isomorphic surface an APP does not type.
//
// The mirror of `abide/server/internal`, and it exists for the same reason that one does: `#shared`
// is a SUBPATH IMPORT, resolved against the `package.json` of whichever package the importing file is
// in — so inside an app it names that app's own shared seam and can never name this one. Without an
// entry point here, a name that is deliberately off the front door would be one an app's own suites
// could not import at all. It used to work by accident, through a `paths` map one config held for
// every package in the repo, which is also why it worked for nobody outside it.
//
// The line is drawn by WHO ASKS. `abide` is what an author types; these three are what a suite
// testing the reactive graph reaches for, and no page or handler in either app types one. A scope is
// something the compiler and the renderers own on an author's behalf.

// `isolate` is the SUBSTRATE's own storage boundary — one variable, set and put back — where `scope`
// below is a reactive one. They are unrelated mechanisms with adjacent names, which is the whole
// reason both are here rather than one of them being reachable and the other not.
export { isolate } from './internal/scopes.ts'
// `scope` disposes every `watch` created inside it; `untrack` reads without subscribing. Both are on
// `reactive.ts`'s public face and neither is on the front door — see the note there.
export { scope, untrack } from './reactive.ts'
