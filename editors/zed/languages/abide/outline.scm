; The outline of a `.abide` file: its blocks, not its markup.
;
; An entry per element would be a tree of `<div>`s that says nothing — what a reader is looking for in
; a page is the two script blocks, the components it defines, and the control flow between them.

(script_element
  (script_start_tag) @name) @item

(style_element
  (style_start_tag) @name) @item

(component_block
  (component_define
    "component" @context
    (component_name) @name)) @item

(if_block
  (if_start
    "if" @context
    (expression_text) @name)) @item

(for_block
  (for_start
    "for" @context
    (binding_text) @name)) @item

(switch_block
  (switch_start
    "switch" @context
    (expression_text) @name)) @item

(try_block
  (try_start "try" @name)) @item

(comment) @annotation
