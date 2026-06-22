/*
A source-map JSON object, narrowed to the fields abide reads or writes when
post-processing emitted maps. `sources` is the list of original files (a null
entry means an unknown source); `ignoreList` (Source Map v3 / ECMA-426) and its
legacy Chrome alias `x_google_ignoreList` carry the indices into `sources` a
debugger should skip. Other standard fields (`version`, `mappings`, …) are passed
through untouched, so the type stays open.
*/
export type SourceMap = {
    sources?: (string | null)[]
    ignoreList?: number[]
    x_google_ignoreList?: number[]
    [field: string]: unknown
}
