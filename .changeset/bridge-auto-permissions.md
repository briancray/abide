---
"@abide/bridge": minor
"@abide/abide": minor
---

The bridge runs Claude Code in auto mode, and asks the page about anything auto mode would ask you: `provider.claudeCode` yields each prompt as a `permission` event, and `provider.claudeCode.permit(id, allow)` answers it. A granted tool is no longer approved just for being granted. `abide-bridge --full` (and `abide-bridge install --full`) gives a site everything your Claude Code has, and the native app's own bridge always runs that way.
