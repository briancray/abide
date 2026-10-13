# @abide/abide

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
