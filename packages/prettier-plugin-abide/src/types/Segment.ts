/*
One slice of a `.abide` source in document order, the unit the formatter masks
before reflowing the markup (see formatAbideSource). `raw` is template markup
handed to Prettier's HTML engine as-is; `expr` is the trimmed code inside a `{…}`
interpolation, masked to a placeholder token so the HTML parser never sees the
braces; `script`/`style` carry their open/close tags around a body masked to a
placeholder element so the HTML pass leaves it untouched. After the HTML pass the
placeholders are restored, formatted as TypeScript/CSS. Every segment carries its
absolute `[start, end)` source range.
*/
export type Segment =
    | { kind: 'raw'; value: string; start: number; end: number }
    | { kind: 'script'; open: string; body: string; close: string; start: number; end: number }
    | { kind: 'style'; open: string; body: string; close: string; start: number; end: number }
    | { kind: 'expr'; value: string; start: number; end: number }
