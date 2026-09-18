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

// One arm of a control block. `subject` is the source between the braces — a condition for
// `{#if}` and `{:else if}`, and EMPTY for `{:else}`, which is what makes it the arm that always
// takes.
export type Branch = {
    subject: string
    children: TemplateNode[]
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
    // 32.13 — a control block renders ONE branch. A REGION: its shape depends on a value, which
    // makes it the one place a marker earns its bytes. `invariance.spec.ts` is why that marker
    // has to be a comment, and `benchGrid.ts` is why there are none anywhere else.
    | { kind: 'block'; block: 'if'; branches: Branch[] }
