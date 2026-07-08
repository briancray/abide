/*
A template interpolation sitting in a NON-content value position — where a
`Promise`/`AsyncIterable` can't be rendered over time and would silently stringify
to `[object Promise]` (Stage E of type-directed lowering, ADR-0019). `loc`/`code`
are the expression's source offset and verbatim text (the classifier's key), and
`position` names the position for the diagnostic. `for await` is the sanctioned
`{#for await}` iterable — the one value position where an `AsyncIterable` is allowed.
*/
export type ValuePositionInterpolation = {
    loc: number
    code: string
    position: 'attribute' | 'if' | 'switch' | 'each' | 'for await'
}
