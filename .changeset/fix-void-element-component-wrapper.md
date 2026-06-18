---
"@abide/abide": patch
---

fix(ui): don't emit a void element as a component's mount wrapper. A component instance mounts into a wrapper tag derived from its name (`<Search>`→`<search>`); when the name lowercases to a void element (`<Input>`→`<input>`, `<Img>`→`<img>`) the wrapper self-closes and the HTML parser reparents the component's own markup as the wrapper's siblings, so on hydration `openChild` finds the wrapper empty, claims `null`, and `attr` throws `null is not an object (setAttribute)` — aborting hydration. Such names now map to a hyphenated custom-element tag (`abide-input`, never void) made layout-transparent with `display:contents`, so the child's real root still lays out as a direct child of the parent. Both the SSR string and the client build go through the shared `componentWrapperTag`, keeping them in agreement.
