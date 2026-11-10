---
"@abide/abide": patch
---

A `.abide` file whose last `@abide/abide` import names `props` no longer compiles to an import joined onto the next import's line, which was a syntax error, and an import of `props` split over several lines is now read as one.
