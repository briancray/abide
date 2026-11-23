---
"@abide/abide": minor
---

`stepper` and `wizard`. `stepper({ min, max, step })` is WAI-ARIA's spin button: a field the arrow keys step, PageUp and PageDown ten at a time, Home and End to its bounds, with buttons either side outside the tab order, and a number typed kept to its bounds and its step (56.29-56.32). `wizard({ steps, valid })` takes a task in steps: a marker per step, the one on `aria-current="step"` and those before it a way back, `next` waiting on `valid`, and `progress` a `meter` of how far it has come (51.141-51.144).
