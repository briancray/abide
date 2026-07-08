/*
How a `{expr}` template interpolation resolves at runtime, from its checker type:
`promise` (thenable — awaited), `asyncIterable` (drained over time), or `sync`
(bound as a plain value). Stage A of type-directed interpolation lowering
classifies into this; later stages pick the binding back-end from it.
*/
export type InterpolationKind = 'promise' | 'asyncIterable' | 'sync'
