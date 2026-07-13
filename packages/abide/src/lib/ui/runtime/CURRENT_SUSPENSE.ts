import type { Suspense } from './types/Suspense.ts'

/*
The ambient client suspense boundary — the sibling of `CURRENT_BOUNDARY`, kept a SEPARATE channel
(ADR-0042 D3) so a pending suspend and a `{#try}` error never cross. A `suspenseBlock` (installed by
the compiler at a component root with blocking cells) sets `current` to its boundary around the
guarded build so every effect created inside associates with it (`suspenseFor`), then restores the
previous value (boundaries nest, the innermost wins). Undefined outside any suspense boundary; a
plain mutable holder is enough — read only on the cold path where an effect is created inside a
boundary, never on the reactive hot path.
*/
export const CURRENT_SUSPENSE: { current: Suspense | undefined } = { current: undefined }
