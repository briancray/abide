---
"@abide/abide": minor
---

feat(dom): make `{snippet(args)}` interpolations reactive in their arguments. Previously `appendSnippet` read the call once at mount and never re-ran, so an argument derived from reactive state froze its initial value (e.g. `{grouped(Object.groupBy([...aired, ...upcoming]))}` rendered with `upcoming` still `[]`, never updating when a later effect populated it). The call is now bounded by a range and wrapped in an effect — like `when`/`each` — so an argument change tears the snippet down and re-mounts it with fresh args (the body's own reads stay fine-grained within a mount; args behave like props). Create mode now emits the `<!--abide:snippet-->` range markers the server already rendered, so the markers are congruent on both sides rather than a server-only asymmetry.
