// What a `.abide` template parses into. Build-time only — nothing here is reached from
// the client's static closure, and none of it is walked per row.

export type Attribute = {
    name: string
    // Static text. A reactive or interpolated attribute is 32.4 and is not parsed yet.
    value: string
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
