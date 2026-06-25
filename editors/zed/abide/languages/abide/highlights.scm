; comments
(comment) @comment

; lowercase tags are elements
((tag_name) @tag
    (#match? @tag "^[a-z]"))

; uppercase tags are components (rendered as a type/constructor)
((tag_name) @tag.component.type.constructor
    (#match? @tag "^[A-Z]"))

(doctype) @tag.doctype
(attribute_name) @attribute
(entity) @string.special

[
  "\""
  "'"
  (attribute_value)
] @string

"=" @operator

[
  "<"
  ">"
  "<!"
  "</"
  "/>"
] @tag.punctuation.bracket
