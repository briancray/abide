// Types a REGISTRY signature may name without abide declaring them: JavaScript's own, the
// web platform's, Bun's, and the one interop spec. MAINTAINED BY HAND — a signature
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
    'Iterable',
    'Map',
    'Omit',
    'Partial',
    'Promise',
    'PromiseLike',
    'Record',
    'Set',
    'Uint8Array',
    // Web platform
    'AbortSignal',
    'Element',
    'HTMLButtonElement',
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
    // Not a type: the second cell of a row whose subject is a COMMAND, not a signature.
    'CLI',
])
