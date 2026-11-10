---
"@abide/abide": patch
---

`imagePiece` draws a JPEG at any size, so a photo's EXIF — a phone's GPS among it — is not sent with it and its orientation is applied (44.52). `imageFiles` hands back a pasted or dropped HEIC or HEIF, which `imagePiece` draws as a JPEG wherever the browser can decode one, and refuses where it cannot (44.55, 44.54).
