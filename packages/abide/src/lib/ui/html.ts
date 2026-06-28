import { RAW_HTML, type RawHtml } from '../shared/html.ts'

/*
Marks a string as trusted raw HTML so a `{expr}` interpolation inserts its nodes
instead of escaped text — the abide idiom for raw markup (no `{@html}` mustache).
Works two ways:

  html(trustedString)        // plain call — insert the string verbatim
  html`<b>${name}</b>`       // tagged — concatenate parts verbatim

Calling `html` is the explicit opt-in to raw insertion; plain `{value}` always
escapes. The tag does NOT auto-escape interpolations (it's raw by intent), so only
build markup from values you trust, or escape them yourself. Imported by the author
(`import { html } from 'abide/ui/html'`) — it is UI-authoring vocabulary, only ever
written inside a template, so it lives in `ui/` (the reader, `rawHtmlString`, is the
isomorphic plumbing and stays in `shared/`).
*/
// @documentation templating
export function html(strings: TemplateStringsArray | string, ...values: unknown[]): RawHtml {
    if (typeof strings === 'string') {
        return { [RAW_HTML]: strings }
    }
    let markup = strings[0] ?? ''
    for (let index = 0; index < values.length; index += 1) {
        markup += String(values[index]) + (strings[index + 1] ?? '')
    }
    return { [RAW_HTML]: markup }
}
