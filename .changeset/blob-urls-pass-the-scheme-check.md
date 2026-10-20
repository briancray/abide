---
'@abide/abide': patch
---

fix: a `blob:` or `data:` URL passes the URL-attribute scheme check (RULEBOOK 32.20), so `<image href={objectUrl}>` or `<img src={dataUrl}>` shows its image instead of being written empty
