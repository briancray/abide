// What a `.abide` template parses into. Build-time only — nothing here is reached from
// the client's static closure, and none of it is walked per row.

export type Attribute = {
    name: string
    // The literal text, or the expression source where `expression` is true.
    value: string
    // `attr={expr}` rather than `attr="text"`. The field is always present rather than added
    // on the expression path, so the record has one shape.
    expression: boolean
}

export type TemplateNode =
    | {
          kind: 'element'
          tag: string
          attributes: Attribute[]
          children: TemplateNode[]
      }
    | { kind: 'text'; text: string }
    // The source between the braces, verbatim. 32.1 renders it escaped.
    | { kind: 'expression'; source: string }
