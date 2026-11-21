---
'@abide/abide': minor
---

`tooltip.host()` is the popover hints show in as parts, as `toasts.host()` and `prompts.host()` are: called from the script of the one component that shows hints and spread onto markup of your own — `<span {...hints.hint}>{hints.text()}</span>`. `Tooltips` is default markup over it. Hints are text only. A `chart`'s readout opens in its own `tip` part against the crosshair rather than in the page's `Tooltips`, and `crosshair()` takes no hint (RULEBOOK 50.47, 50.54-50.56, 52.80).
