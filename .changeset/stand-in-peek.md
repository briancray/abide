---
"@abide/abide": patch
---

A headless part's stand-in `Reactive` (`tabs.selected`, `wizard.current`, `calendar.month`) peeks untracked, as any value does: a body that peeks one is no longer rerun by a write past it
