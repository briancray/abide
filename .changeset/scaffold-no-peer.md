---
"@abide/abide": patch
---

the `bunfig.toml` `abide scaffold` writes now sets `[install] peer = false`, so a dependency's peer on `bun` (`bun-plugin-tailwind`'s) cannot install an older bun that shadows the system one inside `bun run` (RULEBOOK 38.122)
