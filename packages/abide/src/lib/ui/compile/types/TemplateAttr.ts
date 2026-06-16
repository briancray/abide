/*
An element attribute. `static` is a literal; `expression` is `name={code}` bound
reactively; `event` is `on<event>={code}` where `code` evaluates to the handler;
`bind` is `bind:<property>={lvalue}`, a two-way binding whose `code` is the
writable doc path read into the property and written back on input. `loc` is the
absolute offset of `code` in the original `.abide` source (see TextPart) —
optional, set only when the parser tracks positions for the type-checking shadow.
*/
export type TemplateAttr =
    | { kind: 'static'; name: string; value: string }
    | { kind: 'expression'; name: string; code: string; loc?: number }
    | { kind: 'event'; event: string; code: string; loc?: number }
    | { kind: 'bind'; property: string; code: string; loc?: number }
