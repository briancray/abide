# Abide — Zed extension

Registers the `.abide` language and runs the **abide language server** (`abide lsp`)
so Zed shows type-check diagnostics on template expressions and child-component
props — the same errors `abide check` reports, mapped onto the component source —
**and** the syntax highlighting for everything abide-specific.

## How highlighting works

Two sources, composed by Zed in `semantic_tokens: "combined"` mode:

| Surface | Owner |
|---|---|
| `<script>`→TypeScript, `<style>`→CSS embedded bodies | **tree-sitter-html** (this extension pins its own copy) |
| Element/component tag names, attribute names + string values, comments; `{#…}` / `{:…}` / `{/…}` block framing; type-aware `{expr}` interiors | **`abide lsp`** via LSP semantic tokens |

`abide lsp` owns the markup *structure* too — not just `{expr}` interiors — because
tree-sitter-html has no production for abide's `attr={expr}` values: a multiline
template-literal attribute (`code={`…`}`) drops the html grammar into error recovery
that never re-syncs, miscoloring every element below it. The LSP emits tag/attribute/
comment tokens from a raw-source scan (independent of a successful parse), so in
`combined` mode those override the broken tree-sitter parse wherever real structure
sits. tree-sitter remains the fallback when the LSP isn't running.

`parseTemplate` — the same parser that compiles and type-checks components — is the
single source of truth for the abide-specific syntax, so highlighting can never
disagree with the build, and `{expr}` interiors get real type-aware colors (function
vs variable vs type vs property) that a static grammar can't produce. There is **no
Svelte dependency** and no bespoke abide grammar to maintain.

The one tradeoff: the LSP-driven layer needs `"semantic_tokens": "combined"` turned
on (Zed defaults it off, and an extension can't flip it). Without it you still get
html structure + embedded TS/CSS; the `{#…}` blocks and expression interiors render
as plain text, and elements below an `attr={expr}` value stay miscolored by the raw
tree-sitter parse — all of which the LSP layer fixes once enabled.

## Setup

**Scaffolded projects (`abide create`)** ship a committed `.zed/settings.json`:

```json
{
  "auto_install_extensions": { "abide": true },
  "semantic_tokens": "combined",
  "global_lsp_settings": {
    "semantic_token_rules": [
      { "token_type": "tag", "style": ["tag"] },
      { "token_type": "attribute", "style": ["attribute"] }
    ]
  }
}
```

So once this extension is published to the Zed registry, opening the project
auto-installs it and enables semantic tokens — zero manual steps. For an existing
project, drop those keys into your `.zed/settings.json` (or global settings).

The `semantic_token_rules` map abide's `tag`/`attribute` semantic tokens to your
theme's matching syntax styles. They're needed because `tag`/`attribute` aren't
*standard* LSP token types, so Zed ships no default style for them — without a rule,
element/attribute names below an `attr={expr}` value (where tree-sitter has desynced
and the LSP is the only source) render uncolored. The standard types the LSP also
emits — `string`, `operator`, `comment`, `type` (components) — color from Zed's
built-in rules, so they need no entry.

The extension already ships these two rules as defaults (`languages/abide/semantic_token_rules.json`),
so strictly the only key your settings *must* carry is `"semantic_tokens": "combined"`
(an extension can't flip that one). The scaffold lists the rules explicitly anyway —
belt-and-suspenders, and so they apply even against an older extension build.

## Install (dev extension)

Until the extension is published, install it locally. Zed compiles a dev extension's
Rust crate to WASM on install, so you need Rust:

```sh
# 1. Rust toolchain + the wasm target Zed builds against
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-wasip1   # (older Zed: wasm32-wasi)

# 2. In Zed: command palette →  zed: install dev extension
#    pick this directory:  editors/zed/abide

# 3. Enable the LSP highlighting layer (settings.json) — see Setup above for the
#    full block: "semantic_tokens": "combined" + the tag/attribute token rules
```

The server command resolves in this order (see `src/lib.rs`):

1. a `abide` binary on the worktree PATH (global install or `node_modules/.bin/abide`);
2. otherwise `bun packages/abide/bin/abide.ts lsp` — so it works while developing
   abide itself, with the worktree root as the project.

It's a TypeScript server, so after editing abide's source you pick up changes by
restarting the language server (`editor: restart language server`) — no extension
rebuild. Rebuild the extension only after changing `src/lib.rs` or the grammar pin.

If the grammar fails to build, bump `commit` under `[grammars.html]` in
`extension.toml` to a current `tree-sitter/tree-sitter-html` revision.

## CLI equivalent

No editor needed for a one-shot check:

```sh
abide check        # type-check every .abide component, non-zero exit on errors
```
