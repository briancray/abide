---
"@abide/abide": minor
---

Breaking: a headless component built on another hands back that component's parts whole, under its name (49.18). `chat` hands back `dropzone` and `autoscroll`: the composer no longer takes drops itself and the transcript no longer follows its bottom itself — spread `{...talk.dropzone.host}` where files land and `{...talk.autoscroll.host}` with `transcript`; `talk.jump` is `talk.autoscroll.jump`, and `talk.dropzone.input` is a file picker.
