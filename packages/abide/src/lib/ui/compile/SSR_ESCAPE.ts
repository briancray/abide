import { SNIPPET_CLOSE, SNIPPET_OPEN } from '../runtime/RANGE_MARKER.ts'

/*
Source text for the `$esc` / `$attr` / `$spread` / `$text` / `$snip` helpers injected
into every SSR render body. `$esc` escapes the five HTML-significant characters. `$attr`
renders a dynamic `{expr}` attribute with the same present/absent semantics the
client `attr` binding uses: false/null/undefined drops it, true emits the bare
attribute, anything else emits `name="escaped"`. `$spread` renders a `{...obj}`
element spread — each key as an attribute via `$attr`, skipping functions (event
handlers, wired client-side by `spreadAttrs`) and any key in the `skip` list (a key the
element names explicitly, which wins over the spread) — mirroring that client runtime. `$snip` brands a snippet's
rendered string. `$text` is what `{expr}` interpolations push: a snippet call's
value is emitted raw between `<!--abide:snippet-->` markers (the client runs its
builder there to claim the nodes); a `html\`…\`` value raw between `<!--abide:html-->`
markers; anything else is escaped. The brands are registered Symbols so they match
across bundles. Emitted inline (not imported) so the generated render module is
self-contained.
*/
export const SSR_ESCAPE =
    // Nullish escapes to empty text, never the literal `"undefined"` — a pending async
    // read (ADR-0032 D3) renders nothing. `$attr` guards nullish before it calls `$esc`,
    // so its whole-value undefined still drops the attribute.
    'const $esc = (v) => (v == null ? "" : String(v)).replace(/[&<>"\']/g, (c) => ' +
    "({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c]);\n" +
    'const $attr = (n, v) => (v === false || v === null || v === undefined) ? "" ' +
    ': v === true ? (" " + n) : (" " + n + \'="\' + $esc(v) + \'"\');\n' +
    'const $spread = (o, skip) => { let s = ""; for (const k in o) { ' +
    'if (skip && skip.indexOf(k) >= 0) continue; ' +
    /* Skip keys that aren't valid attribute names: $attr emits the name verbatim, so a
       runtime-controlled key with whitespace/quotes/`>`/`=`/`/` would inject markup. The
       client's setAttribute throws on these, so dropping them matches that behaviour. */
    'if (/[\\s"\'>\\/=]/.test(k)) continue; ' +
    'const v = o[k]; if (typeof v !== "function") s += $attr(k, v); } return s; };\n' +
    "const $RAW = Symbol.for('abide.rawHtml');\n" +
    "const $SNIP = Symbol.for('abide.snippet');\n" +
    'const $snip = (s) => ({ [$SNIP]: s });\n' +
    'const $text = (v) => (v !== null && typeof v === "object" && $SNIP in v) ' +
    `? ('<!--${SNIPPET_OPEN}-->' + v[$SNIP] + '<!--${SNIPPET_CLOSE}-->') ` +
    ': (v !== null && typeof v === "object" && $RAW in v) ' +
    "? ('<!--abide:html-->' + v[$RAW] + '<!--/abide:html-->') : $esc(v);"
