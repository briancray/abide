/*
A parser-local diagnostic — deliberately smaller than `AbideDiagnostic`, which
additionally needs the `file` + `category` the parser cannot know. `start` is the
absolute, `baseOffset`-relative offset (the same coordinate space every node `loc`
uses, so it round-trips through the shadow `mappings`); `length` is 0 for a point
diagnostic. Callers (`collectAbideDiagnostics`) adapt it to `AbideDiagnostic`.
*/
export type ParseDiagnostic = { message: string; start: number; length: number }
