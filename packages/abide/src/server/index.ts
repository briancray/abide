// The server seam — what an app reaches through `abide/server`.
// Request handling, SSR and the rpc boundary. Nothing here may be reached from the client
// entry's static closure.
//
// THE COMPILER IS NOT HERE. It was reserved for `./build` and moved to its own #compiler seam:
// this module is public surface, so a compiler under it is one `export *` from being an app's
// dependency. `packages/abide/tests/compiler.test.ts` holds that apart.

// THE WHOLE ISOMORPHIC SURFACE, re-exported rather than owned. A server module imports `GET` and
// `reactive` through this one specifier — the same callable, by the same name, that `abide`
// hands a page. It is also every run-time half an
// emitted module reaches through here: 32.1's escaping and 32.2's `raw`, which both sides render
// markup with, 32.21's `safeUrl`, and 31.8's `writePath`.
export * from '#shared'
export { type Component, render, type Shell } from './render.ts'
// 32.18's run-time half: one invocation, rendered where it stands, with the anchors that make the
// child's markup one thing for the client to walk to.
export { renderComponent } from './renderComponent.ts'
export {
    DELETE,
    GET,
    PATCH,
    POST,
    PUT,
    type Rpc,
    type RpcOptions,
} from './rpc.ts'
