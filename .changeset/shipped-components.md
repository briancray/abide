---
"@abide/abide": minor
---

abide ships headless components and the helpers beside them. Components, each its own entry (`@abide/abide/<Name>.abide`): `Dialog`, `Prompts`, `Toasts`, `Tooltip`, `Menu`, `Combobox`, `Tabs`, `SortableTable`, `Markdown`, `LineChart`, `Sparkline`, `Chat`, `Pairing` — no stylesheet, styled by the `data-` attributes and `data-part`s they write (RULEBOOK 49). `prompts` and `toasts` come from their components' own entries (`import Toasts, { toasts } from '@abide/abide/Toasts.abide'`). From `@abide/abide`: `format`, `markdown`, `chart`, `place`, `listbox`, `sortRows`, `hotkeys`, `keyLabel`, `isEditableTarget`, `dismissible`, `dropzone`, `copyText`, `transcript`. From `@abide/abide/server`: `signedIn`, `requireRole`, `readOnly`, `fetchJson`, `fetchText`, `job`
