/*
Source text for the `$esc` / `$text` helpers injected into every SSR render body.
`$esc` escapes the five HTML-significant characters. `$text` is what `{expr}`
interpolations push: a value branded by `html\`…\`` (a registered Symbol, so it
matches across bundles) is emitted raw between `<!--belte:html-->` markers so the
client knows the region's extent; anything else is escaped. Emitted inline (not
imported) so the generated render module is self-contained.
*/
export const SSR_ESCAPE =
    'const $esc = (v) => String(v).replace(/[&<>"\']/g, (c) => ' +
    "({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c]);\n" +
    "const $RAW = Symbol.for('belte.rawHtml');\n" +
    'const $text = (v) => (v !== null && typeof v === "object" && $RAW in v) ' +
    "? ('<!--belte:html-->' + v[$RAW] + '<!--/belte:html-->') : $esc(v);"
