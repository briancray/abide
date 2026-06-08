---
"@briancray/belte": minor
---

add a same-origin manual rebuild trigger to dev: `POST /__belte/reload` (sibling of the `/__belte/dev` live-reload channel) signals the orchestrator over IPC to rebuild + restart on command. Pair it with `BELTE_DEV_NO_WATCH=1 belte dev`, which skips the src/ file watcher so a long-lived in-process job (e.g. an agent editing the app's own source) isn't torn down by a save. Default `belte dev` is unchanged; the trigger adds no extra port.
