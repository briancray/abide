---
"@abide/abide": minor
---

`dropzone` is parts: `dropzone(options?)` hands back `host` (spread on the drop or paste target, `data-dragging` while files hover), `input` (spread on an `<input type="file">`, the keyboard's way in, filtered as a drop is), `files` (what the last drop, paste or pick took, replacing what was there; bind your own with `files`) and `rejected`. Migrate `bind:element={dropzone(onFiles, options)}` to `{...dropzone({ ...options, onfiles: onFiles }).host}`; `onfiles` and `onreject` are optional and are handed the event as an `Event`. `form`'s parts take one shape: `form` for the `<form>` (was `element`), `field(name)` handing back the field's `input`, `error`, `message` and `invalid`, the whole form's `message` and `error` (was `message('')`), and `submit` and `issues` read as members (RULEBOOK 49.11, 53.17-53.20, 53.46, 53.59, 53.60, 56.9, 56.10, 56.13).
