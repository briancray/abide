/*
An element attribute. `static` is a literal; `expression` is `name={code}` bound
reactively; `event` is `on<event>={code}` where `code` evaluates to the handler;
`bind` is `bind:<property>={lvalue}`, a two-way binding whose `code` is the
writable doc path read into the property and written back on input.
*/
export type TemplateAttr =
    | { kind: 'static'; name: string; value: string }
    | { kind: 'expression'; name: string; code: string }
    | { kind: 'event'; event: string; code: string }
    | { kind: 'bind'; property: string; code: string }
