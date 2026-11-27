---
"@abide/abide": minor
---

A `hotkeys` binding may name its key by where it sits: `KeyQ`, `Digit1`, `mod+KeyK`, `Slash` match `KeyboardEvent.code` whatever the layout types there, so a French keyboard's A-where-Q runs `KeyQ` and its `&` runs `Digit1` (53.6). `keyLabel` and a `MenuItem`'s `key` read such a binding as the key it types on a US layout.
