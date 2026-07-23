# Abide — Zed extension

Local Zed dev extension for `.abide` files: runs the `abide lsp` language server and
applies baseline syntax highlighting.

## What you get

- **Language server** — Zed spawns `abide lsp` (over stdio) for every `.abide` file:
  diagnostics, hover types, go-to-definition, completion, signature help, find-references.
- **Highlighting** — two layers, combined (`"semantic_tokens": "combined"`):
  - **LSP semantic tokens** — `abide lsp` colors the markup + block framing from abide's
    *own* parser (`parse.ts`), so element/component tags, attributes, directives
    (`bind:` / `class:` / `on…`), comments, and `{#if}`/`{:else}`/`{/for}` framing are
    colored exactly as the compiler parses them — no second grammar to drift.
  - **tree-sitter-html grammar** — the structural base: folding, bracket matching, and
    injecting inline `<script>` (as TypeScript) / `<style>` (as CSS).

Enable it with the Zed settings in the repo `.zed/settings.json` (see below).

    Inside every brace-delimited expression — `{…}` interpolations, attribute `={…}` values,
    spreads, AND block headers (`{#if …}`, `{#for … of …}`, `{:case …}`) — plus the whole
    **`<script>` body**, the LSP colors keywords (`await`, `import`, `const`, `of`, …),
    string / number literals, comments, and operators (via TypeScript's own scanner) —
    **syntactically**. Script-body coloring comes from the LSP rather than the HTML grammar's
    injection, which is unreliable inside a `.abide` (the injection is derailed by
    `{#if}`/`{expr}`/`class:x` syntax). `<style>` bodies are still colored via the injection.

## What you don't get (yet)

Inside expressions, plain **identifiers** (a variable, a function call, a property) are left
at the default color — syntactic scanning can't tell them apart without type info. Type-aware
identifier coloring would need the LSP to classify the lowered TS through the checker (a
follow-up), or a dedicated `tree-sitter-abide` grammar. (Interpolations embedded inside a
*quoted* attribute value — `class="a{x ? 1 : 2}"` — also aren't scanned; the whole quoted
value reads as one string.)

## Zed settings

Add to your project (or user) `settings.json` so Zed overlays the LSP tokens and themes
the custom `tag`/`attribute` token types (already wired in this repo's `.zed/settings.json`):

```json
{
  "languages": {
    "Abide": { "semantic_tokens": "combined" }
  }
}
```

**`semantic_tokens` is a per-language setting** (`languages.Abide.semantic_tokens`) and defaults
to `"off"` (Zed 1.10+) — it MUST be set for the LSP's highlighting (block framing, expressions,
`<script>`) to appear at all. `keyword` / `operator` / `string` / `comment` / `number` are
standard LSP token types with Zed default rules, so they color without extra config; the
non-standard `tag` / `attribute` types fall back to tree-sitter HTML's own coloring.

> ⚠️ **Do not add `semantic_token_rules` under `lsp.abide`** with `zed_extension_api` 0.7.0 — the
> extension reads `lsp.abide` via `LspSettings::for_worktree`, and that newer field traps the WASM
> component (`wasm trap: cannot enter component instance`), so the language server never starts.

## Which `abide` does it run?

Resolution order:

1. An explicit Zed `settings.json` override (below) — always wins.
2. The project's own `node_modules/.bin/abide` — preferred when the package is installed
   into the open worktree.
3. `abide` on your `PATH`.

Note that `~/.bun/bin/abide` currently links to the **`~/Code/abide`** checkout — *not*
this `abideclean` tree — so the PATH fallback resolves there. To force **this** repo's LSP,
add a binary override in Zed `settings.json`:

```json
{
  "lsp": {
    "abide": {
      "binary": {
        "path": "/Users/briancray/.bun/bin/bun",
        "arguments": [
          "/Users/briancray/Code/abideclean/packages/abide/src/cli/bin.ts",
          "lsp"
        ]
      }
    }
  }
}
```

(Or re-link the global: `cd packages/abide && bun link` from this repo.)

## Requirements

- `abide` on your `PATH` (`which abide` resolves — currently `~/.bun/bin/abide`), or a
  binary override as above.
- `node` on your `PATH` (`abide lsp` forwards to `node lsp.ts`).
- The Rust toolchain with the `wasm32-wasip1` target — Zed compiles the extension on
  install:

  ```sh
  rustup target add wasm32-wasip1
  ```

## Install

1. Open Zed → command palette (`cmd-shift-p`) → **`zed: install dev extension`**.
2. Select this directory: `packages/zed-abide`.
3. Open any `.abide` file. Check the language indicator (bottom bar) reads **Abide** and
   the LSP is running via **`editor: debug: open language server logs`**.

After editing extension files, re-run **`zed: install dev extension`** (or the extensions
page shows a Rebuild button) to pick up changes.
