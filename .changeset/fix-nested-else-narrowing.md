---
"@abide/abide": patch
---

fix(check): narrow `<template else>` against the condition's negation. The shadow type-checker emitted a nested `else` child inside the `if` block, so the else body inherited the if's positive narrowing — a literal-union compare read as "no overlap" and a `typeof`-narrowed branch saw the wrong member. It now pairs the `else` child as a real `if (…) {…} else {…}`, matching the runtime's pairing.
