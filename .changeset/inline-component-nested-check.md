---
'@abide/abide': patch
---

`abide check` no longer fails when an inline component is passed to a component that sits inside another component's body: the outer close tag's read in the check's projection now ends with a `;`, so the braces that scope the passed component are not parsed as an arrow function.
