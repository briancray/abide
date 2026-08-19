// The server surface an APP does not type.
//
// `abide/server` is what the docs app covers — a page at `/docs/<name>` with at least one rung on it,
// and a name with no page is not public. That rule leaves a second set: names abide's own CLI needs, names the suites
// that test this package reach for, and the wiring `abide start` does on an app's behalf. They are
// still real exports and still typechecked; they are simply not the surface anyone is asked to learn.
//
// A specifier rather than a comment, because an app may not use abide's `#server` alias — that alias
// is `packages/abide`'s own. Without an entry point here, demoting a name would mean the
// example's own tests could no longer import it at all, and the split would have to be enforced by
// prose. It is now enforced by resolution.
//
// The line is drawn by WHO CALLS: `abide start` boots, dispatches and installs the request scope, so
// `boot`, `dispatch` and `serve` are here while the four lifecycle hooks and the five request-scope
// ambients stay public. Anyone hand-rolling a Bun.serve reaches this specifier and gets the same
// functions the CLI uses — there is no second implementation.

// The path the app is SERVED UNDER. `config()` installs it from `APP_URL` and `abide start` reads it
// back to build a URL; an app writes neither, so a suite driving a based route reaches here.
export { mountBase, useMountBase } from '#shared/internal/mount.ts'
// The three conclusions `config()` publishes as `APP_NAME` / `APP_VERSION` / `APP_DATA_DIR`, as the
// functions that compute them. Here rather than public because an app reads the FIELD: two ways to
// ask one question is the disagreement this pair exists to make impossible, and the accessor is the
// half only abide calls.
export { appName } from '#shared/log.ts'
// The navigation protocol's SERVER half. `outlet()` is what an app writes and is `outletFrom(0)`;
// rendering from a DEPTH is what answers a navigation, and only a server does it — `cli/internal/
// layers.ts` pairs these two to leave the shared layouts out of the fragment.
export { outletFrom, sharedLayoutDepth } from '#shared/router.ts'
// The sheet every `adopt()` registered, as `<style>` tags. Written into `<head>` by the document
// render, which is `abide start`'s job.
export { styleTags } from '#shared/styles.ts'
export { appDataDir, appVersion } from './app.ts'
// The transport seam's SERVING half. `GET` / `POST` / `socket` declare an endpoint; these five are how
// one gets answered, and `abide start` mounts them.
export { endpoints, register, registered } from './catalogue.ts'
// The process runner. `onStart` / `onStop` / `onError` / `middleware` DECLARE; these three RUN, and
// what runs them is `abide start`.
export { boot, handle, shutdown } from './lifecycle.ts'
// The OpenAPI projection of that same catalogue. HERE rather than on the public door for the reason
// `endpoints` is: both are what a TOOL reads, not what an app types — `abide start` already serves
// each of them at an address, and an app wanting the document at build time or under a name of its
// own is reaching past the front door on purpose. The MCP projection has no export at all, because
// its only caller is the endpoint that serves it.
export { type OpenApiDocument, type OpenApiOptions, openapi } from './openapi.ts'
// The route table read off a directory. `abide build` writes it and `abide start` hands it to
// `routes()`, so an app names a page by putting a file in `pages/` rather than by calling this.
export { pages } from './pages.ts'
export { dispatch, websocket } from './registry.ts'
// The seven render faces that are not `render`. A 3x3 matrix over {node, document, fragment} x
// {generator, string, stream}, with one hole — `abide start` renders the DOCUMENT and needs all three
// of its faces, and a fragment is what a navigation answers with. `render` itself is public: it is
// the generator over a node, and a caller wanting a string drains it.
export {
    documentToStream,
    fragmentToStream,
    renderDocument,
    renderDocumentToString,
    renderFragment,
    renderToString,
    toStream,
} from './render.ts'
// Checking a declared shape, which happens inside `respond` before a handler is called. An app
// declares `{ schema }` on an rpc and never runs the check itself.
export { SCHEMA_ERROR, validateJson } from './schema.ts'
// Installing the caller scope, as opposed to reading it. `serve` is what makes a module-level `memo`
// per-request; `request` / `bag` / `cookies` / `nonce` / `trace` READ what it installed and stay
// public. `heldStream` and `isServing` are the two probes only a body-building path asks.
export { heldStream, isServing, serve } from './scopes.ts'
// The document pages are served IN. `abide start` reads `app.html`, cuts it here and publishes it
// with `useAppDocument`, which is what `render(view, { shell: true })` then answers with from
// anywhere in the app. An app reaching for these NAMES is hand-rolling the host — building a shell
// itself, or standing in for the boot that publishes one — which is what this specifier is for.
export { type AppDocument, type Shell, shell, useAppDocument } from './shell.ts'
