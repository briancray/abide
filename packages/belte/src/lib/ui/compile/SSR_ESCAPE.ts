/*
Source text for the `$esc` helper injected into every SSR render body — escapes
the five HTML-significant characters in interpolated values. Emitted inline (not
imported) so the generated render module is self-contained.
*/
export const SSR_ESCAPE =
    'const $esc = (v) => String(v).replace(/[&<>"\']/g, (c) => ' +
    "({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c]);"
