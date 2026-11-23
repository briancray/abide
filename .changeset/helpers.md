---
"@abide/abide": minor
---

Three helpers. `highlight(text, query, { words })` cuts a text into runs, each holding the query carrying a `match` part — the matcher `combobox` and `commandPalette` mark their lists with, handed to an app (52.110, 52.111). `shrinkImage(file, { maxEdge, maxBytes, type })` makes a picture small enough to send, lowering its quality and then its size to fit a byte budget, the same call where Bun runs (through `Bun.Image`) and in a browser (through a canvas), and hands a file already within bounds back as it is (53.79-53.81). `download(data, name)` saves text or bytes made in the page as a named file, and throws on a server (53.82, 53.83).
