; Element / script / style indentation is tree-sitter-driven (tree-sitter-html).
;
; `{#…}` control-flow blocks are NOT listed here on purpose: their indentation
; is regex-driven via config.toml's increase/decrease_indent_pattern, so it is
; uniform across every block and grammar-independent — the html grammar does not
; parse `{#…}` blocks at all (they are highlighted by abide lsp semantic tokens),
; and a tree-sitter block range would also push `{:else}`/`{/if}` one level too deep.
[
  (element)
  (script_element)
  (style_element)
  (start_tag ">" @end)
  (self_closing_tag "/>" @end)
  (element
    (start_tag) @start
    [(end_tag) (erroneous_end_tag)]? @end)
  (script_element
    (start_tag) @start
    [(end_tag) (erroneous_end_tag)]? @end)
  (style_element
    (start_tag) @start
    [(end_tag) (erroneous_end_tag)]? @end)
] @indent
