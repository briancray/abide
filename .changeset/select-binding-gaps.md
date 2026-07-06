---
"@abide/abide": minor
---

Close the `<select>` and boolean/numeric binding gaps.

- **`<select bind:value>` now handles late-mounting options.** Options produced by a `{#for}` block or async data mount *after* the binding runs, and the browser drops a `value` set that names a not-yet-present option — so the initial value silently failed to apply. The bind now routes through a new `bindSelectValue` runtime helper (`./ui/dom/bindSelectValue`) that re-applies the selection whenever the option set changes (via a `MutationObserver`), covering static, `{#for}`, and async options uniformly.
- **`<select multiple bind:value>`** binds an array of the selected option values (two-way): the bound array drives which options are `selected`, and a user's picks are collected back into it.
- **SSR selects the matching option.** A server-rendered `<select bind:value>` now emits `selected` on the matching `<option>` (single) or every member (multiple) — the browser ignores a `value="…"` on the select, so the pre-hydration/no-JS state was wrong before. Option value is taken from its `value` attribute, else its static text.
- **`<details bind:open>` SSR fix.** `open` is a boolean attribute, so the old generic path emitted `open="false"` and rendered the element *open* when closed. It now emits the bare attribute only when truthy, like `checked`.
- **Numeric input coercion.** `bind:value` on `<input type="number">` / `type="range"` now writes back a number (via `valueAsNumber`, empty field → `undefined`) instead of a string, so number-typed state stays a number.
