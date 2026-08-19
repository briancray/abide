; Where a `.abide` file stops being markup.
;
; The grammar deliberately never looks inside a script body or a `{…}` hole — `expression_text` is one
; opaque token whose END the external scanner finds. This is the other half of that decision: the text
; is handed to the language it actually IS, so a template expression highlights as the TypeScript it
; is rather than as a dialect of the template.

; `<script>` and `<script module>`. TypeScript rather than JavaScript because it is the superset, and
; a `.abide` script body may be either.
(script_element
  (raw_text) @injection.content
  (#set! injection.language "typescript"))

(style_element
  (raw_text) @injection.content
  (#set! injection.language "css"))

; Every hole, and every block header that carries an expression: `{name}`, `{#if count > 1}`,
; `{:case 'a'}`, `{#for … by item.id}`.
(expression_text) @injection.content
(#set! injection.language "typescript")

; A `{#for}`'s list. Its own token only because the scanner has to stop it at a top-level `by`.
(list_text) @injection.content
(#set! injection.language "typescript")

; NOT injected, on purpose: `binding_text` is a destructuring PATTERN and `parameters` is a signature,
; and neither is an expression. Injecting them would report an error against text that is correct, so
; both are coloured as plain variables in `highlights.scm` instead.
