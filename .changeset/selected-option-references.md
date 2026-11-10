---
"@abide/abide": patch
---

The server render of a bound `<select>` reads its options' character references as a browser does: an out-of-range numeric reference such as `&#9999999;` becomes U+FFFD rather than throwing a `RangeError` out of the render, a reference without its `;` is read, and only ASCII whitespace is collapsed, so a no-break space in option text survives.
