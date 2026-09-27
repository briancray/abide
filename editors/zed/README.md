# abide for Zed

`.abide` files in Zed: highlighted by abide's own grammar (`../tree-sitter-abide`) — markup, `{…}`
slots and `{#…}` blocks, with every slot, block header and `<script>` read as TypeScript and every
`<style>` as CSS — and every finding `abide check` reports shown on the line as you type, from
`abide lsp`, checking the text in the editor rather than the text on disk.

## Install

In Zed, run **zed: install dev extension** and pick this directory. Zed builds it (it needs Rust
from rustup) and starts the server the first time a `.abide` file opens.

The grammar is fetched by the commit `extension.toml` pins, so a change to it reaches Zed once it
is committed and the pin moves to that commit.

## Which `abide` runs

The first of:

1. `lsp.abide.binary` in Zed's settings —
   `{ "lsp": { "abide": { "binary": { "path": "/path/to/abide", "arguments": ["lsp"] } } } }`
2. the project's own, `node_modules/.bin/abide`, run with `bun`
3. `abide` on the `PATH`

The server finds each file's app itself — the directory its `ui/` sits under — so a monorepo
opened at its root checks every app in it.
