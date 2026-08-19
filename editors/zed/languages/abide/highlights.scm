; What a `.abide` file looks like.
;
; Everything between braces is handed to the TypeScript grammar by `injections.scm` and is not
; coloured here — so this file is only ever about the MARKUP and the block syntax around it.

(comment) @comment

; --- tags -------------------------------------------------------------------
;
; Lowercase is an element and uppercase is a component: the compiler's own rule, which the grammar
; already made into two token classes, so neither of these needs a `#match?` to ask again.

(tag_name) @tag
(component_name) @type

; `<slot/>` is the one tag the compiler answers itself rather than passing through.
((tag_name) @keyword
  (#eq? @keyword "slot"))

[
  "<"
  ">"
  "</"
  "/>"
] @punctuation.bracket

; --- attributes -------------------------------------------------------------

(attribute_name) @attribute

; `bind:`, `class:` and `style:` are compiler directives rather than attributes the document keeps —
; picked out by their spelling, which is exactly how `classify()` tells them apart.
((attribute_name) @keyword
  (#match? @keyword "^(bind|class|style):"))

; `onclick={…}` is a listener on an element and an ordinary prop on a component.
((attribute_name) @function
  (#match? @function "^on[a-z]+$"))

; `<script module>` — the attribute that decides whether a block is module scope or component setup.
(script_start_tag
  (attribute (attribute_name) @keyword
    (#eq? @keyword "module")))

(attribute_value) @string
(quoted_attribute_value ["\"" "'"] @string)

"=" @operator

; --- holes ------------------------------------------------------------------

(expression ["{" "}"] @punctuation.special)

; `{raw(…)}` is the escape hatch: the one hole whose contents are not escaped before they reach the
; document. Marked so it does not read like every other interpolation.
((expression (expression_text) @keyword.special)
  (#match? @keyword.special "^raw\\s*\\("))

; --- control flow -----------------------------------------------------------

[
  "{#"
  "{:"
  "{/"
] @punctuation.special

(if_start "if" @keyword)
(if_start "}" @punctuation.special)
(else_marker ["else" "if"] @keyword)
(else_marker "}" @punctuation.special)
(if_end "if" @keyword)
(if_end "}" @punctuation.special)

(for_start ["for" "await" "of" "by"] @keyword)
(for_start "}" @punctuation.special)
(for_start (binding_text) @variable)
(for_end "for" @keyword)
(for_end "}" @punctuation.special)

(switch_start "switch" @keyword)
(switch_start "}" @punctuation.special)
(case_marker "case" @keyword)
(case_marker "}" @punctuation.special)
(default_marker "default" @keyword)
(default_marker "}" @punctuation.special)
(switch_end "switch" @keyword)
(switch_end "}" @punctuation.special)

(try_start "try" @keyword)
(try_start "}" @punctuation.special)
(catch_marker "catch" @keyword)
(catch_marker (identifier) @variable)
(catch_marker "}" @punctuation.special)
(finally_marker "finally" @keyword)
(finally_marker "}" @punctuation.special)
(try_end "try" @keyword)
(try_end "}" @punctuation.special)

(component_define "component" @keyword)
(component_define (component_name) @type)
(component_define (parameters) @variable)
(component_define "}" @punctuation.special)
(component_block_end "component" @keyword)
(component_block_end "}" @punctuation.special)
