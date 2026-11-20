---
"@abide/abide": minor
---

**breaking:** `Tabs.abide` is replaced by `tabs({ keys, selected })`, parts an app spreads onto elements of its own — `list`, `tab(key)` and `panel()` — so a tab holds anything, and `panel(key)` gives each tab a panel of its own, hidden while another is selected and kept (RULEBOOK 51.36-51.44)
