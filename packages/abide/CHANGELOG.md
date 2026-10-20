# @abide/abide

## 0.111.0

### Minor Changes

- f9b3789: ABIDE_OFFLINE — a built app keeps its pages and bundle in a service worker and installs as a web app, a call that reaches no server refuses 503 and a stale value goes on serving, and the socket mux redials when the browser comes back online ([`ee0428a`](https://github.com/briancray/abide/commit/ee0428a958fc70bf13eb10f2d8df2d7b8f3232df))

### Patch Changes

- f9b3789: a request is never reaped by the idle timeout while it is being answered, an idle connection is reaped after 10 seconds, and every event stream beats every 15 seconds ([`14eea6e`](https://github.com/briancray/abide/commit/14eea6e7ae0b72eb194c16e17ca4e7c4498baf46))
- f9b3789: the client bundle is built in the NODE_ENV of its mode, not of the process that started the build ([`c94a975`](https://github.com/briancray/abide/commit/c94a975f38da935b0f62e52789cefe07d5e887ba))
- 0838a38: fix: a `blob:` or `data:` URL passes the URL-attribute scheme check (RULEBOOK 32.20), so `<image href={objectUrl}>` or `<img src={dataUrl}>` shows its image instead of being written empty
- 110aa66: a `ttl` of `Infinity`, or past the 2^31 - 1 ms `setTimeout` holds, no longer re-arms its timer every millisecond for the life of the value: `Infinity` arms none, and a longer `ttl` arms at the cap and re-arms from there

## 0.110.4

### Patch Changes

- 2838836: an MCP tool call under a mount is asked under the mount, so a route whose first segment is the mount's name no longer 404s ([`0ceed49`](https://github.com/briancray/abide/commit/0ceed4966d55cd1b56902dc88c7961725319418f))

## 0.110.3

### Patch Changes

- 804b901: the root below a mount is the bare mount, url('/') writing /docs and /docs/ redirected to it ([`9c5d3c3`](https://github.com/briancray/abide/commit/9c5d3c360c27f2d9918fb663d7aff83b22078707))

## 0.110.2

### Patch Changes

- 14ee265: an SVG element spelled in camelCase hydrates, the compiler asking for the tag the parser writes inside an <svg> ([`f10c81b`](https://github.com/briancray/abide/commit/f10c81bff3ce0e43762a71e24634a218312c0d93))

## 0.110.1

### Patch Changes

- 2aac4eb: an MCP tool's inputSchema is an object at its top level, and args that can never be one refuse the app at boot ([`ec9d80b`](https://github.com/briancray/abide/commit/ec9d80bb6f8902ba1d9f016f6dcd85eba83a47ef))

## 0.110.0

### Minor Changes

- bfa7a68: Breaking: a server-only module and a test are named by file rather than by directory — `<name>.server.<ext>` under `lib`, `.test.ts` anywhere; `lib` and `public` are the only fences ([`e8e2666`](https://github.com/briancray/abide/commit/e8e266676a90d4f4534b74c6373116a1cbab277b))

## 0.109.0

### Minor Changes

- f969612: claudeCode.bridgeCommand and claudeCode.bridge take tools, and the command they mint grants them after its -- ([`d20a962`](https://github.com/briancray/abide/commit/d20a962523f91161cb731e766863256fd5d90208))

## 0.108.0

### Minor Changes

- fda92c3: every MCP tool call writes a debug line on abide:mcp, and every assistant conversation one on abide:assistant ([`6c4d8c7`](https://github.com/briancray/abide/commit/6c4d8c745491308c0208eb18e900473fb8ee9e03))

### Patch Changes

- fda92c3: a back or forward that reloads no longer writes the departed page's scroll into the entry being loaded ([`294c0e6`](https://github.com/briancray/abide/commit/294c0e6ed806c38e80a1f872e7be6ac5579c7382))
- fda92c3: a site holds a dropped bridge pairing for 60 seconds, past when the bridge notices a silent drop ([`ac8e1d3`](https://github.com/briancray/abide/commit/ac8e1d313b7ea54414cd1034b56eb4cfa88ab31b))
- fda92c3: bind:value on a <select> selects an option added after the value was written ([`cd592b2`](https://github.com/briancray/abide/commit/cd592b2ccdc617c5cfed2a6acf5f5a458bc9986b))
- fda92c3: markup the client parses for a raw value, an {#if} arm or a {#for} row inside an <svg> or <math> is parsed in that namespace ([`f8ba81e`](https://github.com/briancray/abide/commit/f8ba81e94e0583858811e3c403535c0c0632b87c))

## 0.107.0

### Minor Changes

- bd2a74f: Breaking: an assistant announces a tool call as the model starts writing it, and a site may ask the visitor's Claude Code for built-in tools ([`c959804`](https://github.com/briancray/abide/commit/c959804fd19c3e99fe439f3f1120f1ef13f42ff8))

### Patch Changes

- bd2a74f: a bind:element callback is handed a connected node whose blocks and components have built, and bind:element on a component is a build error ([`e15fbee`](https://github.com/briancray/abide/commit/e15fbee6f7c780dab2105ca245dd79dbb4a2e317))

## 0.106.0

### Minor Changes

- 9aa03a5: socket mux bounds, request ceilings, stop timeout, scroll restore, numeric and composed bind:value, and keyed rows kept across patches (16.78, 18.28-18.32, 30.29-30.31, 32.58-32.62, 32.66, 32.67, 42.17) ([`301bf47`](https://github.com/briancray/abide/commit/301bf47adf5059271b439fe3c129963861dd1c72))
- 9aa03a5: block tags and template context, cited clauses on diagnostics, lsp references and completions, derived answer schemas, and a scaffold with a handler and its test (32.63-32.65, 38.112-38.118, 19.21-19.24) ([`4f86359`](https://github.com/briancray/abide/commit/4f86359c7f995e2ec8c7b71d1bce5bae4cccc465))
- 9aa03a5: publish @abide/harness, with abide's bench and e2e moved to abide and the arms to the docs app (43.1, 43.21, 43.23, 38.119) ([`8521bd7`](https://github.com/briancray/abide/commit/8521bd7b364d998a1a59f764b51b34cf273f7a84))

### Patch Changes

- 9aa03a5: a render's scope is held while the values it seeded are in flight, so a joined stream closes (41.13) ([`09d7aa0`](https://github.com/briancray/abide/commit/09d7aa040d20205dddd5c8de19a425523f5124a4))
- 9aa03a5: an error page's document is marked, so the browser hydrates no page over it and leaving it is a document load (35.18) ([`28daeed`](https://github.com/briancray/abide/commit/28daeed1468c8f466c722d177a5abbf5afaf333a))
- 9aa03a5: url() takes a union of route literals with optional params ([`3cd7683`](https://github.com/briancray/abide/commit/3cd76831f9dc0867b9a2f8576803ca9ddcac845e))
- 9aa03a5: a mutation called twice in one turn is two writes (16.7) ([`60c5915`](https://github.com/briancray/abide/commit/60c5915be24e843eee0671fa0db444aeb8a69525))
- d42dfad: @abide/abide/test preloads no build from a workspace's root ([`c76a54e`](https://github.com/briancray/abide/commit/c76a54e3ddaf03d42c5534dee97c124856d063fb))
- 9aa03a5: a request with no args is held to a derived args schema, so a missing required member is refused (19.9) ([`e8e65f9`](https://github.com/briancray/abide/commit/e8e65f9ac7de561deb649b19c792ca31dd816008))
- 9aa03a5: a checker releases the snapshots it replaced, and abide lsp closes an app's checker once none of its pages is open ([`fc19c96`](https://github.com/briancray/abide/commit/fc19c965fb2ef5abdc873279a1091806f2745ac9))

## 0.105.1

### Patch Changes

- fdfe14c: an emptied list clears its region in one write ([`b190cd1`](https://github.com/briancray/abide/commit/b190cd19cd5cf0bda5797a6308eddb5ada1af13b))

## 0.105.0

### Minor Changes

- 98e55a3: the app is laid out once per compile, hooks are read by what a module imports, and abide lsp reports the tree's refusals (37.1, 38.34) ([`3b3c6c2`](https://github.com/briancray/abide/commit/3b3c6c277f9cc65a9b08a0d3b4115e7ff8e7c3c5))
- 98e55a3: a child whose setup made a call is built after the turn, as a page is (41.28) ([`6ae9acd`](https://github.com/briancray/abide/commit/6ae9acd75855b446de1680e4413deb47e0a223d9))
- 98e55a3: a component's <head> follows the component, and an unkeyed contribution replaces in place and leaves with it (39.13-39.16) ([`8dc5e9e`](https://github.com/briancray/abide/commit/8dc5e9e22054a13bb7fa648ef7df11a243f19639))

### Patch Changes

- 98e55a3: streamed answers end with their run, carry X-Accel-Buffering, and sse is read by its fields (16.75, 16.76, 16.77, 18.27) ([`696c5cb`](https://github.com/briancray/abide/commit/696c5cb61cbeb0d83382d742924ff8a35cd14339))
- 98e55a3: a command means one app, reports its first build on stderr, and abide openapi prints to stdout (38.25, 38.110, 38.111) ([`7ca9f4b`](https://github.com/briancray/abide/commit/7ca9f4b90294ca34f55c0ce3a725a336f8c1f11b))
- 98e55a3: an unkeyed reactive with a store built outside a request reads it lazily (11.71) ([`acf9440`](https://github.com/briancray/abide/commit/acf94407f779617d63cdc7ed5f371870d58e151e))
- 98e55a3: a query record and an rpc's URL args share one spelling (30.28) ([`b8c3c48`](https://github.com/briancray/abide/commit/b8c3c48b1c3b056d7172f7aad4b2f1a184b39689))
- 98e55a3: a keyed list's row record lives with its nodes in rows.ts ([`e37bbb1`](https://github.com/briancray/abide/commit/e37bbb170685cb2714584287d22946c229050781))

## 0.104.0

### Minor Changes

- c95d974: Breaking: for await over a reactive is one run ([`0013bd0`](https://github.com/briancray/abide/commit/0013bd0a279bc73cbd5d5db3f4424bd2a2418fac))
- c95d974: Breaking: mcp publishes every handler as a tool ([`a983075`](https://github.com/briancray/abide/commit/a98307582cc388f38c3d2377e176f74fe41b63da))
- c95d974: Breaking: a hook called outside a .abide or a handler file is a build error (37.13) ([`c03e97c`](https://github.com/briancray/abide/commit/c03e97c05d27db709ecb02ad06a53574b1c98ee5))
- c95d974: a server directory nests under lib or tests (23.16) ([`f928540`](https://github.com/briancray/abide/commit/f928540ecbe57af94c780a2b73c7109ef87faa52))

### Patch Changes

- c95d974: every spelling of a handler file import is the face the server mounts (16.2) ([`1e2e721`](https://github.com/briancray/abide/commit/1e2e72171950f7b3d0144fbe12b4e6d35c226fbd))

## 0.103.0

### Minor Changes

- dc5611c: BREAKING: a file is its segment. A page is the `index.abide` in its directory, and `src/invoices/index.abide` answers `/invoices` — `page.abide` is gone. A `.ts` beside the pages is a handler file, its handler its default export (`export default GET(…)`), answering at its own path: `src/invoices/getInvoice.ts` is `/invoices/getInvoice`. A `.abide` no longer exports: a handler a page alone calls is a `const` in its `<script server>`, private, answered below `/__abide/handlers/`, and listed nowhere. Code that is no address lives under a `lib` directory and tests under a `tests` directory, beside the pages they serve; a `.abide` under either is a component whatever it is called, and anything else directly in an address directory fails the build. The desktop launcher's options come from `onLauncher(…)` in `src/launcher.abide`, and a layout's or a page's menus from `onMenu(…)` in its `<script>`, in place of the `launcher` and `menu` exports. `abide sync`, `.abide/types` and the `rootDirs` the scaffold wrote are gone. New: `abide routes` prints every address and hook with the file behind it, and `@abide/abide/test`, preloaded by the scaffold's `bunfig.toml`, lets a test import the app's `.abide` and handler files as modules with nothing booted first.

### Patch Changes

- dc5611c: `abide check` reports an export or a top-level `await` in a `.abide` another one imports at that file, rather than stopping, and reports every refusal the whole app raises — a handler file's, two files at one route, a stray `onLauncher` — at the file that raised it. A mounted package's `server` directory is fenced from the browser's bundle as the app's own is. `abide routes` lists a hook called as a member (`server.onStart(…)`). The language server walks the app once per change rather than on every check, and a build no longer reloads the checker's project for each of the app's own handler files. `abide scaffold` writes the test preload's `bunfig.toml` and the `.gitignore` itself, so a packed release cannot drop them, and adds a `routes` script.

## 0.102.0

### Minor Changes

- e4e4e01: a stack trace from code in a `.abide` names the `.abide` and its line under `abide dev`, `abide start` and a compiled executable, and the client bundle `abide dev` serves carries a source map into the `.abide`
- e4e4e01: `abide sync` writes the types a plain `.ts` reads a `.abide` by, with no checker and no build; the scaffold runs it on `bun install`, and `abide lsp` keeps an open file's types current as you edit
- e4e4e01: a plain `.ts` importing a name a `.abide` exports is typed: `abide check`, `abide dev` and `abide build` write each file's exported types to `.abide/types`, which the scaffold's `tsconfig.json` reaches through `rootDirs` and `paths`
- e4e4e01: a file imported `with { type: 'text' }` from a `.abide` is its text and typed `string`; a `<script server>` may import what its `<script>` imports; children slotted into a component see its `reactive.share` in the browser as on the server; `bind:value` on a path writes back through the path; a list over a `Map`'s values shows a `patch` written through `get`; and a component's `<head>` titles the page after a client navigation
- e4e4e01: A package can ship pages, layouts, error pages and handlers, and the app decides where they answer: `import 'kit/admin' with { type: 'routes' }` in any of the app's `.abide` mounts every `.abide` under the package's `admin` directory at that file's directory. A directory mounts once; mounting one of the app's own, or one that is not there, fails the build. One classifier, `placeOf`, now answers where every file sits, and a name the framework reads off a `<script module>` export is read off the loaded module when it is needed (34.32) — the desktop `launcher` is read as the app launches, not during `abide bundle`.
- e4e4e01: BREAKING: an app is laid out by subject. Every directory under the root is a segment of an address, and a `page.abide`, `layout.abide` or `error.abide` answers at its directory's path — `src/billing/page.abide` is `/billing`; a `server` or `public` directory is never a segment. Handlers are exported from a `<script server>` block in any `.abide` outside those two, and answer at the directory's route plus the export's name — `.ts` handler modules and `src/server/app.ts` are gone, and the root `layout.abide`'s server block holds the app's hooks. `middleware` and `onError` are scoped to their file's route, `onConfig` and `onPrincipal` compose, path params merge into a handler's args, a `server/` directory is fenced from the browser, `public/` directories mount anywhere, and the one import alias is `#src/*`. The desktop launcher's files leave `src/bundle/`: `src/launcher.abide`, beside the root layout, exports its options as a typed `launcher` from its `<script module>`, read as the app launches (no more `launcher.json`, and the app is named by its package), and the icon is the public file at `/icon.png` or `/icon.icns`. The built-in launcher is the icon, the name and a Start and a Connect… button, each opening its form in a dialog, colored by the most saturated hue of the icon.
- e4e4e01: a refusal that reaches a jsonl or sse stream after it answered — a stalled stream's 504 among them — is sent as the stream's last frame and refused by the browser's copy after the chunks it had, rather than read as a dropped connection; a handler's `timeout` now raises the idle timeout a socket tick past itself, so that frame always goes out first

### Patch Changes

- e4e4e01: `abide build` removes a public file the app no longer has from its output, so `abide start` stops answering it. The desktop launcher's Connect… menu item opens the connect dialog again, and `Launch.focus` is the form the page opens on, `undefined` for none. `abide lsp` keeps its scan of the app between checks until its watcher hears a file move, and a compile resolves each `.abide` import once.

## 0.101.0

### Minor Changes

- 128f192: Breaking: an rpc export named as its file answers at the file's path ([`9758128`](https://github.com/briancray/abide/commit/97581285b14d6d01688c963a4332729f6af30d3a))

### Patch Changes

- 128f192: the executable carries the app as bytecode ([`4a72909`](https://github.com/briancray/abide/commit/4a729091955a28df259005b79109ee2e00593046))
- 128f192: followers are filed by entry key, and an SSE event is read off its frame ([`7a137e7`](https://github.com/briancray/abide/commit/7a137e7224daf334c90539c75bb4f7ff25701dc8))
- 128f192: a request's signal aborts when its caller hangs up or its worker is replaced ([`7a57131`](https://github.com/briancray/abide/commit/7a571311b08e2c4d3b14c244395bc7cc29fad4d7))
- 128f192: a page loads only the framework modules it uses
- 128f192: disposed readers are counted rather than found, and the probe edge is cursored ([`ef1bafe`](https://github.com/briancray/abide/commit/ef1bafec810f06bea37a88c51713ac2b92e212e7))
- 128f192: answers of 64 KB or more are compressed off the event loop ([`f484e0d`](https://github.com/briancray/abide/commit/f484e0d140321d9cf2a171cb52dec0b0a3b2c227))

## 0.100.0

### Minor Changes

- 12e5725: Breaking: the rewrite. `@abide/abide` is now the isomorphic, type-safe framework for reactive async interfaces built from compiled `.abide` files — a new surface, not an upgrade of 0.58. Apps import `@abide/abide`, `@abide/abide/runtime` and `@abide/abide/server`; `abide scaffold <name>` writes a starter. The 0.58 line lives on the `og` branch.
