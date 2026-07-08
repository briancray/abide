import type { Boundary } from './types/Boundary.ts'

/*
The ambient reactive error boundary — the `{#try}` mirror of `CURRENT_SCOPE`. A `tryBlock`
sets `current` to its boundary around the guarded build so every effect created inside
associates with it (`boundaryFor`), then restores the previous value (boundaries nest, the
innermost wins). Undefined outside any `{#try}`; a plain mutable holder is enough — the
value is only read on the cold path where an effect is created inside a boundary, never on
the reactive hot path.
*/
export const CURRENT_BOUNDARY: { current: Boundary | undefined } = { current: undefined }
