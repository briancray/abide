; comments as the comment pseudo-language
((comment) @injection.content
  (#set! injection.language "comment"))

; <script> is TypeScript (a superset of the JS the project may also use)
(script_element
  (raw_text) @injection.content
  (#set! injection.language "typescript"))

; <style> is CSS
(style_element
  (raw_text) @injection.content
  (#set! injection.language "css"))

; inline style="" attributes are CSS
(attribute
  (attribute_name) @_name
  (#match? @_name "^style$")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "css"))
