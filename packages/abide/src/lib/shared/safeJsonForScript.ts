/*
Escapes characters that could prematurely terminate the surrounding <script>
tag or be interpreted as HTML comment delimiters when a JSON literal is
inlined into an HTML document. U+2028 (LS) and U+2029 (PS) are valid in JSON
but break a `<script>` tag's inline content because the JavaScript lexer
treats them as line terminators; encode them as Unicode escapes.
*/
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

export function safeJsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/-->/g, '--\\u003e')
        .replaceAll(LINE_SEPARATOR, '\\u2028')
        .replaceAll(PARAGRAPH_SEPARATOR, '\\u2029')
}
