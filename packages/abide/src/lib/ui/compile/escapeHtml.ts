/*
HTML-escapes a compile-time-constant string — a static attribute value or static
text — the same five characters the runtime `$esc` handles. Shared by the SSR
generator and the static-clone skeleton generator so server markup and the client
clone template can't diverge on escaping. Static text reaches here already
entity-decoded (see parseTemplate), so escaping round-trips it through the HTML
parser to the same plain text the client would build directly.
*/
export function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (char) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
    )
}
