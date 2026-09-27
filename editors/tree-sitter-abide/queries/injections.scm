((comment) @injection.content
  (#set! injection.language "comment"))

; 34.1, 34.2 — a `<script>` block is TypeScript.
(script_element
  (raw_text) @injection.content
  (#set! injection.language "typescript"))

(style_element
  (raw_text) @injection.content
  (#set! injection.language "css"))

; What stands between a slot's or a block's braces.
((code) @injection.content
  (#set! injection.language "typescript"))
