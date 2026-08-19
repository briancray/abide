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

## What it does NOT do

The extension exposes what `abide lsp` answers and nothing more, so its limits are the SERVER's and
are not settings you are missing:

* **Go to definition does not exist.** `CAPABILITIES` advertises `textDocumentSync`,
  `completionProvider` and `hoverProvider`, and `receive()` answers every other request with
  `-32601`. Cmd-click on a name in a `.abide` file has nothing to ask, so nothing happens.
* **Hover is narrow.** It answers over a `{#…}` / `{:…}` / `{/…}` marker and over a `bind:` target —
  the two closed tables the compiler owns. Over an ordinary identifier it returns `null`, so most of
  a template is silent. A TYPE under the cursor would need the checker at a position rather than over
  a whole file, which is a different question from the one the type lane answers today.
* **Rename, references, formatting, signature help** — none are implemented.

Diagnostics are the exception and do cover the whole file: parse errors instantly, and real type
errors inside template expressions once the buffer settles.

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
`bun test` runs, so there is no version to keep in step. It looks in four places, in order:

1. `lsp.abide.binary.path` in your Zed settings.
2. `node_modules/.bin/abide` at the worktree root — an app that depends on abide.
3. `bun packages/abide/cli/index.ts` — abide's OWN repo, whose root `node_modules/.bin` has no
   `abide` because the workspace link lands in each package's.
4. `abide` on `$PATH` — a global install.

If none of the four resolves, the server fails to start and says so with all of them named.

Rule 3 is there because rule 4 is dangerous in exactly one place. Opening abide's own repo used to
fall through to `$PATH`, and a global `abide` may be a DIFFERENT checkout — the machine this was
written on has one whose server advertises semantic tokens and no completion. Nothing shows that in
the editor, because the highlighting is the grammar's either way; the only symptom is a hover that
quietly disagrees with the compiler `bun test` runs. A worktree that BUILDS abide is served by the
abide it builds.

To pin it explicitly anyway:

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
