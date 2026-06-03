---
"@briancray/belte": minor
---

`belte bundle` now reads the shipped default-config file from `bundle.env` instead of `.env.bundle`. The old name masqueraded as a member of Bun's `.env.*` autoload family, implying `bun dev`/`bun start` would load it (they never did) and that it should be gitignored like `.env` (it should be committed — it's ship-safe defaults, and a compiled bundle is extractable anyway). The new name reflects what the file is: a build input, not a runtime env overlay. Rename your project's `.env.bundle` to `bundle.env`.
