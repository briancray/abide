# Abide — Zed extension

Registers the `.abide` language and runs the **abide language server** (`abide lsp`)
so Zed shows type-check diagnostics on template expressions and child-component
props — the same errors `abide check` reports, mapped onto the component source.

Syntax highlighting uses the Svelte tree-sitter grammar (`.abide` is HTML-with-`{expr}`
like Svelte), pinned to the same revision as the official Svelte extension.

## Two layers

| What | How | Needs |
|------|-----|-------|
| Syntax highlighting now | project `.zed/settings.json` maps `.abide` → Svelte | the Svelte Zed extension (already installed) |
| Diagnostics (squiggles) | this extension's `abide lsp` server | Rust toolchain to build the extension |

The repo's `.zed/settings.json` gives highlighting immediately. Installing this
extension supersedes it with a real `Abide` language **and** diagnostics — after
which you can delete the `file_types`/`languages` override from `.zed/settings.json`.

## Install (dev extension)

Zed compiles a dev extension's Rust crate to WASM on install, so you need Rust:

```sh
# 1. Rust toolchain + the wasm target Zed builds against
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-wasip1   # (older Zed: wasm32-wasi)

# 2. In Zed: command palette →  zed: install dev extension
#    pick this directory:  editors/zed/abide
```

The server command resolves in this order (see `src/lib.rs`):

1. a `abide` binary on the worktree PATH (global install or `node_modules/.bin/abide`);
2. otherwise `bun packages/abide/bin/abide.ts lsp` — so it works while developing
   abide itself, with the worktree root as the project.

If the grammar fails to build, bump `rev` in `extension.toml` to the current
`tree-sitter-svelte` commit (or copy it from your installed Svelte extension's
`extension.toml`).

## CLI equivalent

No editor needed for a one-shot check:

```sh
abide check        # type-check every .abide component, non-zero exit on errors
```
