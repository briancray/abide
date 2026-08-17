// Where an abide app puts things — the one place the convention is written down.
//
// An app is `src/` split three ways by SUBSTRATE, plus what only a runner loads:
//
//   src/server/   app.ts, rpc/**, sockets/**, and the app's own server code
//   src/ui/       app.html, app.css, pages/**, public/**, and the app's own components
//   src/shared/   what both sides run
//   src/tests/    what neither serves
//
// The same four are the app's SEAMS — `#server`, `#ui`, `#shared`, `#tests`, declared as subpath
// imports in its own `package.json` — so a file's imports say which substrate it depends on rather
// than how many `../` it sits from. Nothing here declares those: a seam is resolved by Bun and `tsc`
// off the package manifest, and abide never sees the specifier. What IS here is the half abide
// RESOLVES on the app's behalf, and every one of these is a directory rather than a declaration —
// the tree is the route table, the tree is the endpoint list.
//
// Its own leaf beside `TRANSPORT.ts`, which was the first half of this rule and now derives its
// anchored spelling from `SOURCE_DIR` rather than carrying a second copy of it. A leaf because
// `TRANSPORT.ts` is in the browser lane and an import edge is priced by the module it lands on: a
// file of strings with no imports of its own cannot cost anybody anything.

/** The one directory an app's own code is under. Everything below is a subdirectory of it. */
export const SOURCE_DIR = 'src'

// The two substrate directories. NOT exported: every reader wants a file or a directory INSIDE one —
// the pages, the public files, the document, the app module — and a seam named on its own is a prefix
// somebody would then join a path onto by hand, which is the counting this file exists to stop.
const SERVER_DIR = `${SOURCE_DIR}/server`
const UI_DIR = `${SOURCE_DIR}/ui`

/**
 * Where the pages are. A directory rather than a declaration — the tree IS the route table.
 *
 * Read by three modules that each write it into something the others have to match: `entry.ts` emits
 * `import('../src/ui/pages/…')` specifiers, `layers.ts` builds graph keys off it, and `start.ts` asks
 * whether an app has any. Two copies is a rename that reaches one and produces a lane importing
 * nothing, with a build that still succeeds.
 */
export const PAGES_DIR = `${UI_DIR}/pages`

/**
 * Files served AS THEY ARE, from the origin root — `favicon.ico`, `robots.txt`, an image a page names.
 *
 * Under `ui/` because that is the substrate they are for: nothing on a server reads them, and a
 * request for one is answered before the request scope is entered, exactly as the client bundle is.
 * They are NOT hashed and NOT in the module graph, which is the whole difference from an asset a
 * component imported — the bundler never saw these, so their addresses are whatever the author typed.
 */
export const PUBLIC_DIR = `${UI_DIR}/public`

/** The app's own document. `.html` because that is what it is. */
export const APP_HTML = `${UI_DIR}/app.html`

/**
 * What an app SAYS about itself, in the order it is looked for.
 *
 * ABSENT is an ordinary app: every export it could hold is optional, so an app of pages and endpoints
 * that wants no hook and no route of its own writes no file at all.
 *
 * Under `server/` rather than above the seams, because every export it holds is a server's: the
 * lifecycle hooks, the middleware onion, and the app's own route. No `.abide` here — a `.abide` file
 * compiles to a COMPONENT, and this module is asked for hooks.
 */
export const APP_MODULES = [`${SERVER_DIR}/app.ts`, `${SERVER_DIR}/app.tsx`, `${SERVER_DIR}/app.js`]
