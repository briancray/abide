// The one shape language, declared once so the compiler and the runtime cannot disagree about it.
//
// JSON Schema is abide's NATIVE representation rather than a projection of something else, and the
// reason is that the projection has to go the other way. Standard Schema — the interop spec zod,
// valibot and arktype all answer to — is validate-only: it hands over a `validate` function and
// nothing that says what the shape IS, so a schema declared through it cannot be turned into a tool
// definition, an OpenAPI document, or anything else a machine reads BEFORE it calls. A shape abide
// can only run is a shape abide cannot publish.
//
// So the order is inverted: JSON Schema is what a declaration means, a library schema is an
// alternative VALIDATOR over the same call, and the compiler derives JSON Schema from the type
// annotation when nobody declared one. Every door — the wire, MCP, an OpenAPI generator — reads the
// same object.
//
// The keywords are ENUMERATED rather than left open, and that is load-bearing twice: it makes
// `JsonSchema` a weak type, so a library schema handed to the same option is a type error here
// instead of being silently accepted as a schema with no keywords in it, and it is the list the
// validator below actually understands. A declaration that needs a keyword abide has no opinion
// about says so with a cast, which is a caller asserting something rather than abide pretending.
//
// Types only. The compiler imports this type-only, exactly as it imports `Kind`, so nothing about
// the runtime reaches the emit path.

/**
 * Which law a declaration is. The DIRECTORY it lives in is what says so.
 *
 * Declared on the leaf both lanes and the compiler already read type-only, and re-exported from
 * `transport.ts` under the name the public surface uses. One declaration because, as `elide.ts` puts
 * it, a `Kind` declared twice is a rename that compiles on both sides and fails on the wire.
 */
export type Kind = 'rpc' | 'socket'

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

export interface JsonSchema {
    /** One type, or the several a union of them derives to. */
    type?: JsonType | JsonType[]
    /** Object members, by name. */
    properties?: Record<string, JsonSchema>
    required?: string[]
    /** `false` closes the object; a schema is the value shape of a `Record`. Unset is open. */
    additionalProperties?: boolean | JsonSchema
    items?: JsonSchema
    /** A closed set of values — what a union of literals derives to. */
    enum?: unknown[]
    const?: unknown
    /** A union that is not a set of literals. */
    anyOf?: JsonSchema[]
    oneOf?: JsonSchema[]
    allOf?: JsonSchema[]
    /**
     * `binary` is a FILE. OpenAPI's spelling, and the one entry here that is not JSON: it is what
     * makes a multipart door describable in the same document as every other call.
     */
    format?: string

    // Understood by the validator.
    minimum?: number
    maximum?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    minItems?: number
    maxItems?: number

    // Carried to whoever reads the shape, and ignored when checking one.
    title?: string
    description?: string
    default?: unknown
    examples?: unknown[]
    deprecated?: boolean
}

/** What one endpoint declares in each direction. Absent where nothing was declared or derivable. */
export interface Shapes {
    input?: JsonSchema
    output?: JsonSchema
}

/** One endpoint as a machine reads it before calling: the whole of what a tool definition needs. */
export interface EndpointShape {
    /** `users/getUser` — the address, and the natural tool name. */
    id: string
    kind: Kind
    /** The method an rpc travels as. Absent on a socket, which is an upgrade rather than a call. */
    method?: string
    description?: string
    /** The handler yields, so the answer arrives as chunks rather than at once. */
    streams?: boolean
    input?: JsonSchema
    output?: JsonSchema
}
