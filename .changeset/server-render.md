---
"@abide/abide": minor
---

add `abide/server/render` — `render(path, params?, query?)` renders a page route to its HTML string in-process, through the same pipeline (app.html shell, layout chain, params, inline rpc reads) an HTTP GET of that URL runs, so a page stays directly linkable and its emailed form is one call away. Arg shape mirrors `url()`/`navigate`.
