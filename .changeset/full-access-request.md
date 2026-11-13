---
"@abide/abide": minor
"@abide/bridge": minor
---

A site can ask a visitor's Claude Code for full access: `provider.claudeCode.bridgeCommand({ full: true })` and `provider.claudeCode.bridge({ full: true })` carry `--full` in the command and ask for it in the link, and `ABIDE_BRIDGE_FULL` does the same for `pairing()`. Opening such a link names no tool: it says the site is requesting full access, and offers Allow Full Access, Only Site Tools or Don't Allow. Allow is now kept for the site and the person its code was minted for, with no separate Always Allow, and an ask for full access is kept as it was answered; `abide-bridge forget` undoes it. The question is a macOS alert with a bold headline, and no longer names the bridge release, which the handler's log keeps.
