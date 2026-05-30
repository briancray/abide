# @briancray/belte

## 0.2.2

### Patch Changes

- [`465928b`](https://github.com/briancray/belte/commit/465928b411b8f8aff582df87f9e2ba3782d8b275) - The generated route-types file (`src/.belte/routes.d.ts`) now augments the `Routes` interface on the module name the project imports belte under (canonical `@briancray/belte` or an alias), matching the rpc/socket/prompt codegen. It previously hardcoded `belte/browser/page`, so `page.route` / `page.params` autocomplete only resolved when belte was installed under the `belte` alias.

## 0.2.1

### Patch Changes

- [`1d84fb8`](https://github.com/briancray/belte/commit/1d84fb8d64d8bb7b4d0eb3b1d24e0ea2f18b4c31) - RPC, socket, and prompt codegen now emit imports under the name belte is installed as in the consuming project — the canonical `@briancray/belte` for a direct dependency, or the alias key for a package alias (`"belte": "npm:@briancray/belte@..."`) — instead of a hardcoded `belte`. A plain `bun add @briancray/belte` now builds with no alias required; the `belte` alias remains supported for the bare `belte/...` import surface.

## 0.2.0

### Minor Changes

- [`cf136c7`](https://github.com/briancray/belte/commit/cf136c7b763283570ef431b3aad269626bea7824) - Add a `belte bundle` desktop app and make the CLI a thin remote-only client.

  - `belte bundle` assembles a movable, self-contained desktop app (a `.app` on macOS, a flat dir elsewhere) that boots into a connect screen — start the embedded server or connect to a remote one by URL.
  - **Breaking:** the CLI binary is now always a thin remote client (talks to a running server over HTTP, `APP_URL` required). Dropped the `--thin`/full split and in-process fallback — use `belte bundle` for the embedded-backend case.
  - **Breaking:** MCP prompts are now markdown files (`src/mcp/prompts/**.md`) with YAML frontmatter, replacing the `.ts` prompt modules.
  - **Breaking:** handlers read the inbound request via `request()` and the live server via `server()` rather than `RequestStore` fields.
  - `json` / `jsonl` / `sse` / `error` / `redirect` accept a trailing `ResponseInit`.
  - Static-asset header caching is shared across asset servers, and zstd decompression moved to the async API.

## 0.1.0

### Minor Changes

- [`c863e56`](https://github.com/briancray/belte/commit/c863e563338fe704fc96a7054e27a35d271261fb) - Initial public release of belte — an isomorphic multimodal HTTP framework for Bun and Svelte. Declare a backend once and consume it over the web (SSR Svelte), the CLI, and MCP.
