const SNIPPET = Symbol.for('abide.snippet')

/* The internal payload a snippet carries — a DOM builder `(host) => void` on the
   client, the pre-rendered HTML string on the server. The brand is a registered
   Symbol so it survives across module/bundle copies (same idiom as `html\`\``). */
export type SnippetValue = { readonly [SNIPPET]: unknown }

/* The author-facing snippet type: a builder invoked with its arguments, yielding a
   mountable value. `children` is `Snippet` (no args, invoked `children()`); a row
   renderer is `Snippet<[Item]>` (invoked `row(item)`). The side-specific payload is
   hidden behind `SnippetValue`. */
export type Snippet<Args extends unknown[] = []> = (...args: Args) => SnippetValue

/* Brands a snippet payload so a `{expr}` interpolation mounts it instead of
   inserting escaped text. The compiler wraps a snippet's body in this — the client
   builder closes over the defining component's scope, the server string is its SSR
   render — so a snippet value passes through props like any other value. */
// @documentation templating
export function snippet<Payload>(payload: Payload): SnippetValue {
    return { [SNIPPET]: payload } as SnippetValue
}

/* The payload of a snippet-branded value, or undefined for anything else — so a
   text binding fast-paths plain values and only branded ones mount. The client
   reads a builder function; the server reads the rendered string. */
export function snippetPayload(value: unknown): unknown {
    return value !== null && typeof value === 'object' && SNIPPET in value
        ? (value as SnippetValue)[SNIPPET]
        : undefined
}
