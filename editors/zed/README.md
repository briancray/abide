# abide for Zed

`.abide` support for [Zed](https://zed.dev): diagnostics, completion and hover from `abide lsp`, over
a tree-sitter grammar built from the same syntax the compiler parses.

## What it does

| | Where it comes from |
| --- | --- |
| Diagnostics | `abide lsp`. Parse errors instantly; type errors inside template expressions once the buffer settles. |
| Completion | `{#…}`, `{:…}` and `{/…}` from `BRANCHES`, and `bind:` targets from `BINDABLE` — the compiler's own tables, so an editor cannot offer a block that does not exist. |
| Hover | The same two tables: what a block takes, and which tag writes a bind target back through which event. |
| Highlighting | `editors/tree-sitter-abide`, with TypeScript injected into every `{…}` hole and every script body, and CSS into `<style>`. |
| Outline, indent, bracket matching | The grammar's blocks — not its `<div>`s. |

## Installing

The extension is not in Zed's registry. Install it as a dev extension:

1. `zed: install dev extension` from the command palette.
2. Choose this directory — `editors/zed`.

Zed compiles the Rust to wasm and builds the grammar itself; nothing needs to be built by hand.

**The grammar comes from a COMMIT, never from the working tree.** Zed builds it by `git fetch`ing the
revision `extension.toml` names into `grammars/` and checking that out, so editing `grammar.js` and
reinstalling does nothing on its own: the change has to be COMMITTED and the `commit` line moved to
the new SHA. That is the whole loop, and skipping its second half is the failure that reads as the
extension ignoring you.

`repository` is a LOCAL PATH, which is what keeps that loop to one step — git treats a filesystem path
as a remote like any other, so a local commit is enough and nothing has to be pushed before it can be
tried. It is also the one line here that is not portable: swap it back to
`https://github.com/briancray/abide`, with a commit that has been pushed, before installing this
anywhere but the machine it was written on.

## Which `abide` it runs

The extension installs no server. `abide lsp` is a subcommand of the binary the app already depends
on, which is the whole point: the compiler that reports a type error in your editor is the one
`bun test` runs, so there is no version to keep in step. It looks in three places, in order:

1. `lsp.abide.binary.path` in your Zed settings.
2. `node_modules/.bin/abide` at the worktree root — an app that depends on abide.
3. `abide` on `$PATH` — a global install.

If none of the three resolves, the server fails to start and says so with all three named.

### This repository is the case that needs the setting

abide's own repo has no `abide` at the ROOT `node_modules/.bin` — the workspace link lands in
`packages/dogfood/node_modules/.bin/abide`. Open `packages/dogfood` as the worktree and it is found
by rule 2; open the repo root and it is not, so point it at the source:

```json
{
    "lsp": {
        "abide": {
            "binary": {
                "path": "bun",
                "arguments": ["packages/abide/cli/index.ts", "lsp"]
            }
        }
    }
}
```

## The grammar

`editors/tree-sitter-abide` is a second reader of `.abide`, and the compiler is the authority — the
component rule (`/^[A-Z]/`), the void elements and the block set all come from it rather than being
restated. It differs on purpose in exactly one direction: it is more permissive, because an editor
holds a half-typed file most of the time and a grammar that refuses one takes the highlighting off
everything around it.

```
bun install                          # in editors/tree-sitter-abide
bunx tree-sitter-cli generate --abi 14
bunx tree-sitter-cli test
```

`src/parser.c` and the two generated JSON files are committed, because Zed compiles the C and never
runs `generate`. ABI 14 is pinned in the `generate` script rather than left to the CLI's default.

The corpus under `test/corpus` covers each block, each attribute form — and RECOVERY: two cases that
assert what survives around a broken buffer. Those two are what the `_error_sentinel` external token
holds up, and reverting it is what shows their worth (one unclosed `{#if` turns the rest of the file
into a single `raw_text` blob, and everything below it loses its tree).

### What it knowingly gets wrong

A regex literal holding an unbalanced brace or quote — `{/}/.test(s)}`. Telling a regex from a
division needs the token before it, which is the state a scanner this size does not keep; the
compiler uses TypeScript's own lexer and has no such problem. The cost is one expression highlighting
as far as the brace, and `abide lsp` still reports the truth about the file.
