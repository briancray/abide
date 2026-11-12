// The server's half of what a compiled `.abide` module and a handler file's loading face import,
// through `@abide/abide/server/runtime` — `@abide/abide/runtime` is the browser's. Tooling, not
// surface: none of these names has a REGISTRY row, and keeping them off `@abide/abide/server` is
// what keeps them out of an app's autocomplete.

import { installServer } from './installServer.ts'

export * from '#shared/emitted.ts'
// 41.28's run-time half: an emitted component reads it on either side of its setup, and one whose
// setup made a call answers as a page does.
export { callsInRender } from './PageRender.ts'
// 16.88's run-time half: what the module a handler file is loaded through calls to give it its
// address.
export { addressed } from './addressed.ts'
// 19.9's run-time half: what the module a handler is loaded through calls to hold it to the schema
// its annotation derives (15.8).
export { derivedArgs } from './argsContract.ts'
// 37.1's run-time half: what a compiled server module calls around its `<script server>`, so the
// hooks it makes are filed at its route.
export { fileRoute } from './hooks.ts'
// 32.17's run-time half: one invocation, rendered where it stands, with the anchors that make the
// child's markup one thing for the client to walk to.
export { renderComponent } from './renderComponent.ts'

// A compiled module is on a server as `@abide/abide/server` makes an app's module one — this entry
// replaced that one as what emitted code imports, so it fills the same slots (`installServer.ts`).
installServer()
