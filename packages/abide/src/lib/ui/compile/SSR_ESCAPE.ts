/*
Source text for the `$esc` / `$attr` / `$text` / `$snip` helpers injected into
every SSR render body. `$esc` escapes the five HTML-significant characters. `$attr`
renders a dynamic `{expr}` attribute with the same present/absent semantics the
client `attr` binding uses: false/null/undefined drops it, true emits the bare
attribute, anything else emits `name="escaped"`. `$snip` brands a snippet's
rendered string. `$text` is what `{expr}` interpolations push: a snippet call's
value is emitted raw between `<!--abide:snippet-->` markers (the client runs its
builder there to claim the nodes); a `html\`…\`` value raw between `<!--abide:html-->`
markers; anything else is escaped. The brands are registered Symbols so they match
across bundles. Emitted inline (not imported) so the generated render module is
self-contained.
*/
export const SSR_ESCAPE =
    'const $esc = (v) => String(v).replace(/[&<>"\']/g, (c) => ' +
    "({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c]);\n" +
    'const $attr = (n, v) => (v === false || v === null || v === undefined) ? "" ' +
    ': v === true ? (" " + n) : (" " + n + \'="\' + $esc(v) + \'"\');\n' +
    "const $RAW = Symbol.for('abide.rawHtml');\n" +
    "const $SNIP = Symbol.for('abide.snippet');\n" +
    'const $snip = (s) => ({ [$SNIP]: s });\n' +
    'const $text = (v) => (v !== null && typeof v === "object" && $SNIP in v) ' +
    "? ('<!--abide:snippet-->' + v[$SNIP] + '<!--/abide:snippet-->') " +
    ': (v !== null && typeof v === "object" && $RAW in v) ' +
    "? ('<!--abide:html-->' + v[$RAW] + '<!--/abide:html-->') : $esc(v);"
