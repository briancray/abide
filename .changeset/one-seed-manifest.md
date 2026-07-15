---
"@abide/abide": patch
---

One hydration seed manifest: the four passive warm-seed globals (`__abideResume`, `__abideCells`, `__abideDocs`, `__abideSockets`) collapse into one kind-partitioned `window.__abideSeeds` (ADR-0048). The in-bundle names (`RESUME`, `CELL_SEED`, `DOC_SEED`, `SOCKET_SEED`) stay as views onto its partitions, so consumers are unchanged; the inline SSR swap/seed scripts write the `resume` partition. Each partition self-initializes, so the vanilla scripts and the bundle compose in either run order. The live streamed-cell machinery and the head collector buffer stay separate — they are apply-timing phases (ADR-0040), not passive manifests. Internal wire-shape change only; `__SSR__` and all authored APIs are untouched.
