---
"@abide/abide": minor
---

- `<window>` and `<document>` take `on<event>` listeners at a file's top level: added on mount, removed when the component leaves, never run on the server (RULEBOOK 39.21-39.23)
- an `on<event>` value may be an `EventListenerObject` — `{ handleEvent, passive: false }` — whose `capture`, `once`, `passive` and `signal` are the listener's options, written or spread (32.95)
- `{#try}…{:pending}…{/try}` renders the pending arm while the body's first load is out, and never again on a reload (32.16, 32.96)
- `abide check` warns on a `{#for}` subject written as `x.ready() ? x : []`, `x || []` or `x ?? []` (32.97)
- a component called directly — `mount(Picker({ job }))` — takes a prop as a `Reactive`, typed and bound as a `bind:` would hand it over (38.195, 38.196)
