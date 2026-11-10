---
"@abide/bridge": minor
---

A link can ask for MCP tools of the visitor's own servers. The bridge finds them in the visitor's Claude Code configuration (user scope) or in the `--mcp-config` they passed, reads them again every turn, and gives a turn only the servers of the tools it was granted (44.15, 44.58). It reports to the site which asked-for tools it cannot give (44.61). The Allow dialog names any tool whose server the visitor lacks (44.65), and offers Always Allow: kept per site and per holder of the code, so a code minted for someone else is still asked about (44.62). `abide-bridge forget [<site>]` makes a site ask again (44.66). `abide-bridge install` now registers on Linux (a desktop entry, asking with `zenity` or `kdialog`) and Windows (registry classes) as well as macOS (44.43, 44.64). Reinstall once to get the new link handler: an older one refuses a link carrying MCP tool names.
