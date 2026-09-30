# tree-sitter-abide

The `.abide` grammar: HTML (tree-sitter-html is the base, and its tag scanner is kept as it is) with
what abide adds — `{…}` slots, `attr={…}`, `{...spread}`, slots in quoted attribute values, and the
`{#if}` / `{#for}` / `{#try}` blocks with their `{:…}` arms. What stands between
braces is a `code` node, balanced by the scanner around strings, template literals and comments.

```
bun install
bunx tree-sitter generate   # after editing grammar.js — src/parser.c is committed
bunx tree-sitter test       # test/corpus
```

On a macOS whose default SDK the linker rejects, point `SDKROOT` at an older one for `test` and
`parse`.
