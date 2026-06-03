---
"@briancray/belte": minor
---

The standalone CLI (`belte cli`) now ships the compiled server beside it and gains an interactive session. `<app> /connect <url>` connects to a remote server, `<app> /start` boots a local instance, `<app> /disconnect` forgets the saved connection, and `<app>` alone resumes it — each opening a prompt where bare words run RPC commands and `/connect` / `/start` / `/disconnect` / `/help` / `/exit` manage the connection. One-shot dispatch (`<app> <command> --flags`) is unchanged for scripting. The connection is remembered in the per-user data dir; with none saved the CLI uses the baked `APP_URL`. The download tarball now bundles the server binary so `/start` works out of the box.
