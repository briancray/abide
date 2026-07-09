---
"@abide/abide": minor
---

Type-directed async-cell classification (ADR-0023). A no-marker `computed`/`linked` stream seed now routes by the seed's checker type instead of a syntax heuristic: a stream produced by *any* expression shape (`computed(obj.stream)`, a conditional) auto-tracks, where before only a bare call/identifier did, and a provably-sync seed skips the runtime probe. Resolved through the warm shadow program and **fails open** to the previous syntactic routing when no program is available; the `await`-marker path is unchanged.
