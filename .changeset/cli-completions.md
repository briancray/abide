---
"@abide/abide": minor
---

add `/completions <bash|zsh|fish>` to the generated CLI binary — prints a shell completion script that tab-completes command names and their `--flags` (with `--no-<flag>` for booleans). Candidates derive from the baked manifest via a live `/completions --query` callback, so completion always reflects the binary's real surface and can't drift from dispatch. No new public export.
