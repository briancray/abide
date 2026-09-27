(tag_name) @tag

; 32.18 — a capitalised tag is a component.
((tag_name) @type
  (#match? @type "^[A-Z]"))

(doctype) @tag.doctype

(attribute_name) @attribute

[
  "\""
  "'"
  (attribute_value)
] @string

(comment) @comment

(entity) @string.special

"=" @punctuation.delimiter

[
  "<"
  ">"
  "<!"
  "</"
  "/>"
] @punctuation.bracket

; A block's word, and the brace that closes it, as one keyword: `{#if` … `}`.
(block_keyword) @keyword

(if_start "}" @keyword)
(else_if_start "}" @keyword)
(else_start "}" @keyword)
(if_end "}" @keyword)
(for_start "}" @keyword)
(for_end "}" @keyword)
(try_start "}" @keyword)
(catch_start "}" @keyword)
(finally_start "}" @keyword)
(try_end "}" @keyword)
(component_start "}" @keyword)
(component_end "}" @keyword)

(expression
  [
    "{"
    "}"
  ] @punctuation.special)

(spread
  [
    "{"
    "..."
    "}"
  ] @punctuation.special)
