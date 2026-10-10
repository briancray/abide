// THE ROUTER'S OWN ENTRY, so that "the router is not part of what every page imports" is true by
// CONSTRUCTION rather than by the bundler agreeing. `@abide/abide/runtime` is what every compiled client
// module resolves through and its own header calls that list the budget; a whole subsystem on it
// is a category error there whatever the bundler then manages.
//
// IT IS NOT A MEASURED BYTE SAVING, and the attempt is worth recording so nobody takes the
// reasoning further than the number goes. Two entries both importing `@abide/abide/runtime`, built
// `--splitting` so the barrel lands in a SHARED chunk — which is the configuration CLAUDE.md names
// as where bun stops shaking — came out 7156 bytes with the router off the barrel against 7160
// with it on, and zero router symbols in the output either way. Bun shook it out. So the argument
// here is the structural one above, plus not resting a budget on a bundler behaviour the project's
// own notes say not to rest one on; it is NOT "this saves the router's bytes", because it does not.
//
// ONE CALLER: the `routes.ts` the build emits for an app that HAS pages, through
// `ROUTING_SPECIFIER`. An app with no `page.abide` under `pages/` never resolves this entry.

export { listenForRoutes } from './listenForRoutes.ts'
export { type PageMount, type Route, Router, startRouter } from './Router.ts'
