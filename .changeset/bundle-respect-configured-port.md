---
"@briancray/belte": patch
---

A bundle's embedded server now honors a configured `PORT` instead of always picking a random free port. The launcher resolves `PORT` from the same env stack the server uses (shell, then the data-dir `.env` the config form writes, then the shipped binary-dir `.env`) and binds it as-is; with none set it falls back to a free port as before. This lets you start the embedded server at a fixed, known address on one machine and reliably connect to it from another via the connect screen.
