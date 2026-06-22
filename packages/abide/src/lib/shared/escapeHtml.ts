/*
HTML-escapes the five HTML-significant characters — the same set the runtime
`$esc` handles. Isomorphic: shared by the build-time SSR/static-clone generators
(so server markup and the client clone template can't diverge on escaping) and
the server runtime's dev error page. Static text reaches the compile callers
already entity-decoded (see parseTemplate), so escaping round-trips it through
the HTML parser to the same plain text the client would build directly.
*/
export function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (char) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
    )
}
