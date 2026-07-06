const SNIPPET = Symbol.for('abide.snippet')

/* A `{#snippet name(args)}` snippet, called like a function: it carries a payload a
   `{expr}` interpolation mounts in place — a DOM builder `(host) => void` on the
   client, the pre-rendered HTML string on the server. The brand is a registered
   Symbol so it survives across module/bundle copies (same idiom as `html\`\``). */
export type Snippet<Payload> = { readonly [SNIPPET]: Payload }

/* Brands a snippet payload so a `{expr}` interpolation mounts it instead of
   inserting escaped text. The compiler wraps a snippet's body in this — the client
   builder closes over the defining component's scope, the server string is its SSR
   render — so a snippet value passes through props like any other value. */
// @documentation templating
export function snippet<Payload>(payload: Payload): Snippet<Payload> {
    return { [SNIPPET]: payload }
}

/* The payload of a snippet-branded value, or undefined for anything else — so a
   text binding fast-paths plain values and only branded ones mount. The client
   reads a builder function; the server reads the rendered string. */
export function snippetPayload(value: unknown): unknown {
    return value !== null && typeof value === 'object' && SNIPPET in value
        ? (value as Snippet<unknown>)[SNIPPET]
        : undefined
}
