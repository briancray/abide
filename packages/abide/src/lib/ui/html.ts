// Public raw-HTML marker for `.abide` templates (M3a).
//
// `{html(str)}` (or the tagged form html`…`) renders a trusted HTML string as real nodes instead of
// escaped text. In a template the compiler INTERCEPTS the `html(...)` call at parse time (see
// internal/parse.ts) and streams the argument as raw markup — so the call is never actually evaluated
// there. This module exists so the documented `abide/ui/html` specifier RESOLVES for the type-checker
// (`tsc` / `abide check`) and so a page that must `import { html }` (no ambient identifiers)
// type-checks. Invoked directly it returns a branded `RawHtml` the renderers treat as pre-escaped.

// A branded pre-escaped HTML string. The brand lets a renderer distinguish trusted markup from a
// plain string without re-escaping it.
export interface RawHtml {
    readonly __abideRawHtml: string
}

export function html(strings: TemplateStringsArray | string, ...values: unknown[]): RawHtml {
    if (typeof strings === 'string') return { __abideRawHtml: strings }
    let out = strings[0] ?? ''
    for (let index = 0; index < values.length; index++) {
        out += String(values[index]) + (strings[index + 1] ?? '')
    }
    return { __abideRawHtml: out }
}
