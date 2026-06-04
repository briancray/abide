---
"@briancray/belte": patch
---

Root-absolute `url()` references in bundled stylesheets (e.g. `url(/fonts/x.woff2)`) are now marked external instead of being resolved against the project root at build time. Those paths are served from `public/` at the site root at runtime, so Bun's CSS bundler previously failed the whole build trying to find them on disk. The literal `/…` path now survives into the emitted CSS, where the public asset server serves it. Relative `url()`s still resolve and bundle as before.
