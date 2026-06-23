---
"@abide/abide": patch
---

Parse `html`-branded raw markup in the parent's namespace. The client-side raw-HTML
binding parsed markup by setting `innerHTML` on a throwaway `<div>`, so the fragment
parser always used the HTML namespace — markup bound inside an `<svg>` produced
HTML-namespaced `<path>`/`<circle>` elements that exist in the DOM but never render.
This only surfaced on client-created or re-rendered nodes; the initial SSR/hydration
path adopts the server markup verbatim and kept the correct namespace, so an icon
component (`{html(svgInnerMarkup)}` inside `<svg>`) rendered on first paint but
vanished the moment its subtree was rebuilt on the client (e.g. a live cache delta).
A new `parseRawNodes` helper picks an SVG holder when the parent is SVG-namespaced,
shared by both `appendText` and `appendTextAt`.
