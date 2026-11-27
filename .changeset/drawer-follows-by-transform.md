---
"@abide/abide": minor
---

A `drawer` given `stops` follows a drag by a `transform` alone, carrying `data-following`, and is sized once it is let go: the drag is stood at its largest stop once and lays nothing out per move (50.63). Let go, it is pushed to its stop and sized when the app's CSS transition on that `transform` ends, at once where there is none — so `[data-drawer=drawer]:not([data-following]) { transition: transform .18s }` animates the settle (50.85). A tap on its handle, a press let go within 8 pixels, stands it at the next stop, going round (50.84).
