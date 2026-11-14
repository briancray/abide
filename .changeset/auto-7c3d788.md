---
"@abide/abide": minor
---

alert, confirm and the update check are sheets, so the app goes on answering while one is open — the event drain lets go of what AppKit autoreleased each pass instead of leaking it, and the window title follows the page's by observation rather than by polling ([`7c3d788`](https://github.com/briancray/abide/commit/7c3d788a7eeed7ec0aef4566bb5caef7fdfb88d9))
