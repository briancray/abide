// Types a REGISTRY signature may name without abide declaring them: JavaScript's own, the
// web platform's, Bun's, the one interop spec, and the browser runner a lane is driven from. MAINTAINED BY HAND — a signature
// reaching for a web API this list has not met fails `every type a signature names is
// declared somewhere`, and the repair is a line here, not an exemption in the test.
export const BUILTIN_TYPES = new Set([
    // JavaScript and TypeScript
    'Array',
    'ArrayBuffer',
    'AsyncGenerator',
    'AsyncIterable',
    'AsyncIterator',
    'Awaited',
    'Blob',
    'DataView',
    'Date',
    'Error',
    'Extract',
    'Function',
    'Iterable',
    'Map',
    'NoInfer',
    'Omit',
    'Partial',
    'Promise',
    'PromiseLike',
    'Readonly',
    'Record',
    'Set',
    'Symbol',
    'Uint8Array',
    // Web platform
    'AbortSignal',
    'Element',
    'HTMLButtonElement',
    'HTMLElementTagNameMap',
    'SVGElementTagNameMap',
    'ReadableStream',
    'Request',
    'RequestInit',
    'Response',
    'ResponseInit',
    'URL',
    'URLSearchParams',
    // Bun
    'CookieMap',
    'Server',
    // Interop
    'StandardSchemaV1',
    // Playwright: the page `@abide/harness/engine` traces, which the test runner hands over.
    'Page',
    // Not a type: the second cell of a row whose subject is a COMMAND, not a signature.
    'CLI',
])
