---
"@abide/abide": patch
---

A `<style>` selector that is only a `::view-transition…` pseudo-element, such as `::view-transition-group(*)`, is left without the component's scope token, so it reaches the document's transition instead of matching nothing. 34.31
