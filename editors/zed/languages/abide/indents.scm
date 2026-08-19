; What opens an indent, and where it closes.
;
; A branch is listed separately from the block that owns it: `{:else}` and `{:case}` are siblings of
; the body before them in the tree, so a block alone would indent the first branch and leave the rest
; flat against the margin.

[
  (element)
  (component)
  (script_element)
  (style_element)
  (if_block)
  (else_branch)
  (for_block)
  (switch_block)
  (case_branch)
  (default_branch)
  (try_block)
  (catch_branch)
  (finally_branch)
  (component_block)
  (start_tag ">" @end)
  (component_start_tag ">" @end)
  (self_closing_element "/>" @end)
  (self_closing_component "/>" @end)
] @indent

(element (start_tag) @start (end_tag)? @end)
(component (component_start_tag) @start (component_end_tag)? @end)
(script_element (script_start_tag) @start (script_end_tag)? @end)
(style_element (style_start_tag) @start (style_end_tag)? @end)
(if_block (if_start) @start (if_end)? @end)
(for_block (for_start) @start (for_end)? @end)
(switch_block (switch_start) @start (switch_end)? @end)
(try_block (try_start) @start (try_end)? @end)
(component_block (component_define) @start (component_block_end)? @end)
