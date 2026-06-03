---
"@briancray/belte": patch
---

`belte dev` and `belte start` no longer load the bundle's config layers (the per-user data-dir `.env` and the shipped binary-dir `bundle.env`). Those layers exist for the compiled standalone app — a bundle launched via `open` has cwd `/` and gets its config there — but the server entry loaded them unconditionally, so dev/start would also inherit them. A `PORT` saved in the data-dir `.env` (written by a bundle's connect screen) then defeated dev's auto port-scan, binding that exact port and throwing `EADDRINUSE` instead of moving on. Dev/start now keep to their project-local CWD `.env` alone; the data-dir/binary-dir layers load only when running as a `bun build --compile` standalone binary.
