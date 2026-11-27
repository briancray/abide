---
"@abide/abide": patch
---

`slider` lands a value in its step's decimals, as `spinbutton` does — a step of 0.1 from 0.6 is 0.7, not 0.7000000000000001 (51.86). A `dialog` opened with `modal: false`, and so a `drawer` beside the page, closes on Escape from focus inside it, which `show` never fired a `cancel` for (50.3).
