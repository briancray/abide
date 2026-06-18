---
"@abide/abide": patch
---

perf(ui): carry the streamed await-block resume value in a `<script type="application/json">` child instead of a `data-resume` attribute. The attribute form HTML-escaped the JSON (`"` → `&quot;`, plus `&`/`<` passes), inflating the raw payload ~38% and costing two full-string regex passes per render (~2.6 ms/MB; ~10 ms for a 3.7 MB payload). Script content is raw text, so only `<` is neutralized as the JSON escape — ~130–150× cheaper to encode and no quote inflation. `applyResolved` and the inline `SSR_SWAP_SCRIPT` now read the value via `.textContent` and drop the script before swapping the resolved markup into its boundary.
