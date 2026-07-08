---
'@abide/abide': minor
---

`props` is now a required import (`@abide/abide/ui/props`), resolved by import binding like `state` — a bare ambient `props()` no longer works, and every component that reads props must `import { props } from '@abide/abide/ui/props'`.

`children` is now an ordinary declared prop instead of an ambient callable: read it with `const { children } = props<{ children: Snippet }>()` (`Snippet` from `@abide/abide/shared/snippet`). Slotted content (`<Panel>…</Panel>`) and an explicit `children={aSnippet}` attribute now set the same `children` prop key (slotted content wins if both are present). `props<T>()` stays additive — a page/layout still gets its route-param shape auto-typed, and declaring `children` (or any other prop) only adds to it.

The `Snippet` type's generic changed from its internal payload to its call arguments: `Snippet<Args extends unknown[] = []>` is now `(...args: Args) => SnippetValue` — `children` is `Snippet` (invoked `children()`), a row/label snippet is `Snippet<[Item]>` (invoked `row(item)`). The former payload-generic form (`Snippet<Payload>` describing the value flowing through) is gone; the internal payload is the newly exported `SnippetValue`.

**Behavior change:** an unguarded `{children()}` on a component mounted without children now throws at render, where it previously rendered nothing. Guard with `{#if children}{children()}{:else}…{/if}`, or declare `children: Snippet` as a required (non-optional) prop so `abide check` catches missing children at the call site.

Migration: add `import { props } from '@abide/abide/ui/props'` to every component that calls `props()`; for any component that reads `children`, add `import type { Snippet } from '@abide/abide/shared/snippet'` and declare it — `const { children } = props<{ children: Snippet }>()` (or `children?: Snippet` if optional).
