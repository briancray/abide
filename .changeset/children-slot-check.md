---
'@abide/abide': patch
---

`abide check` now counts slotted content toward a required `children` prop. The shadow's completeness check treated `children` like any other prop, so `<Card>text</Card>` mounting a component that declares `children: Snippet` was falsely flagged as missing `children` — forcing `children?` optional as a workaround. Slotted content now satisfies the requirement (matching the runtime, which lowers it to the `children` layer), while a childless `<Card />` is still flagged. All other completeness and excess-prop checks are unchanged.
