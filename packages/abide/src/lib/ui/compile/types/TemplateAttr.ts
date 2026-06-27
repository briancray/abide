import type { TextPart } from './TextPart.ts'

/*
An element attribute. `static` is a literal — `bare` marks a valueless attribute
(`disabled`, not `disabled=""`), letting a component coerce it to `true` while a
native element still serialises it as `name=""`; `expression` is `name={code}` bound
reactively; `event` is `on<event>={code}` where `code` evaluates to the handler;
`bind` is `bind:<property>={lvalue}`, a two-way binding whose `code` is the
writable doc path read into the property and written back on input; `attach` is
`attach={code}` where `code` evaluates to an attachment `(node) => teardown` run
at build with node-lifetime teardown; `spread` is `{...code}` where `code`
evaluates to an object whose own keys each become a prop on a component or an
attribute on a native element. `loc` is the
absolute offset of `code` in the original `.abide` source (see TextPart) —
optional, set only when the parser tracks positions for the type-checking shadow.
*/
export type TemplateAttr =
    | { kind: 'static'; name: string; value: string; bare?: true; nameLoc?: number }
    | { kind: 'expression'; name: string; code: string; loc?: number; nameLoc?: number }
    /* `name="literal {expr}"` — a quoted value mixing literal text with `{expr}`
       interpolations (the text-node `parts` model on an attribute). Bound reactively
       as the template-literal concatenation of its parts; always yields a string, so
       the attribute is always present. */
    | { kind: 'interpolated'; name: string; parts: TextPart[]; nameLoc?: number }
    | { kind: 'event'; event: string; code: string; loc?: number }
    | { kind: 'bind'; property: string; code: string; loc?: number }
    /* `class:<name>={code}` — toggles the class on/off by `code`'s truthiness, written
       surgically (classList.toggle) without re-rendering the element. */
    | { kind: 'class'; name: string; code: string; loc?: number }
    /* `style:<property>={code}` — writes one inline style/custom property (style.setProperty)
       reactively, again without a re-render. `property` may be a CSS custom prop (`--pct`). */
    | { kind: 'style'; property: string; code: string; loc?: number }
    | { kind: 'attach'; code: string; loc?: number }
    | { kind: 'spread'; code: string; loc?: number }
